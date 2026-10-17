import { CLIENT_HEADER } from "@klipstack/api-contract/client"
import { createClient, type KlipstackClient } from "@klipstack/sdk"
import { Image } from "expo-image"
import { createContext, type ReactNode, use, useEffect, useMemo, useState } from "react"
import { CLIENT, DEFAULT_API_URL, DEV_API_TOKEN, DEV_APP_REFRESH_TOKEN, USER_AGENT } from "./config"
import { authorize, refresh, revoke, SignedOutError } from "./oauth"
import { forgetOffline } from "./offline-download"
import {
	clearSession,
	markSeeded,
	readSession,
	type Session,
	seededFrom,
	writeSession,
} from "./session-store"
import { forgetListChoices } from "./topic-choices"
import { forgetNextUp, reloadNextUp } from "./widget"

export type AuthState =
	| { status: "loading" }
	| { status: "signed-out" }
	| { status: "signed-in"; client: KlipstackClient }
	/** The server answered `client_outdated`: nothing works until the app is updated. */
	| { status: "outdated" }

type Auth = {
	state: AuthState
	apiUrl: string
	signIn: () => Promise<void>
	/**
	 * Signs in again, password and all, for what needs a recent sign-in (deleting the account).
	 * False when the user closed the sheet: the session stays as it was.
	 */
	signInAgain: () => Promise<boolean>
	signOut: () => Promise<void>
	/** The account was deleted: forget it here, with nothing to revoke. */
	accountDeleted: () => Promise<void>
	/**
	 * Headers for loading the server's stored images (`downloadUrl`s) outside the SDK: the current
	 * access token and the client version. Never send them to any other host.
	 */
	imageHeaders: () => Promise<Record<string, string>>
}

const AuthContext = createContext<Auth | null>(null)

/** Refresh this long before the access token expires. */
const EARLY_SECONDS = 60

/** Everything that doesn't change while the app runs; `setState` reports what happened. */
function createAuth(setState: (state: AuthState) => void) {
	let refreshing: Promise<Session> | null = null
	const signedOut = () => setState({ status: "signed-out" })
	// Signed out by the user or the server: the articles read and kept here go with the session, and
	// so do the lead images the lists cached (stored ones came with the token). A cache that won't
	// clear doesn't keep anyone signed in. The widget stops showing the account's next article, and
	// the lists their topics and filters.
	const forget = async () => {
		await clearSession()
		forgetNextUp()
		forgetOffline()
		forgetListChoices()
		await Image.clearDiskCache().catch(() => false)
		signedOut()
	}

	// The share extension refreshes too, so read the keychain every time instead of caching.
	async function accessToken(force: boolean): Promise<string> {
		const session = await readSession()
		if (!session) {
			signedOut()
			throw new SignedOutError()
		}
		const due = session.expiresAt - EARLY_SECONDS <= Date.now() / 1000
		if (!force && !due) return session.accessToken
		refreshing ??= refresh(session)
			.catch(async (error: unknown) => {
				if (!(error instanceof SignedOutError)) throw error
				// The share extension may have renewed the session meanwhile, which spent the refresh
				// token this one used: take what it stored rather than signing out.
				const stored = await readSession()
				if (stored && stored.refreshToken !== session.refreshToken) return stored
				await forget()
				throw error
			})
			.then(async (next) => {
				await writeSession(next)
				return next
			})
			.finally(() => {
				refreshing = null
			})
		return (await refreshing).accessToken
	}

	const signedIn = (session: Session) =>
		setState({
			status: "signed-in",
			client: createClient({
				baseUrl: session.apiUrl,
				token: ({ refresh: force }) => accessToken(force),
				userAgent: USER_AGENT,
				headers: { [CLIENT_HEADER]: CLIENT },
				fetch: async (input, init) => {
					const res = await fetch(input, init)
					if (res.status === 426) setState({ status: "outdated" })
					return res
				},
			}),
		})

	return {
		async load() {
			// The development app token, once: an expired session that the first request refreshes.
			if (DEV_APP_REFRESH_TOKEN) {
				if (!(await seededFrom(DEV_APP_REFRESH_TOKEN))) {
					await writeSession({
						apiUrl: DEFAULT_API_URL,
						accessToken: "",
						refreshToken: DEV_APP_REFRESH_TOKEN,
						expiresAt: 0,
					})
					await markSeeded(DEV_APP_REFRESH_TOKEN)
				}
			}
			// The development key, as a session that never expires, so the share extension has it too.
			else if (DEV_API_TOKEN)
				await writeSession({
					apiUrl: DEFAULT_API_URL,
					accessToken: DEV_API_TOKEN,
					refreshToken: "",
					expiresAt: 253402300799,
				})
			let session: Session | null
			try {
				session = await readSession()
			} catch {
				// The keychain can't be read now (before the phone's first unlock, say): signed out for
				// now, the session kept for the next launch.
				return signedOut()
			}
			// A session for another server (a switch between development and release builds) is
			// dropped: the app shows the server it will sign in to, and must not call a different one.
			if (session?.apiUrl === DEFAULT_API_URL) return signedIn(session)
			// No usable session, also when the share extension found it revoked and deleted it.
			await forget()
		},
		async imageHeaders() {
			let token: string
			try {
				token = await accessToken(false)
			} catch (error) {
				// Offline, the token can't be renewed: the expired one still lets the lists show the
				// pictures they cached (by URL), and a download fails as it would anyway.
				const session = error instanceof SignedOutError ? null : await readSession()
				if (!session) throw error
				token = session.accessToken
			}
			return { authorization: `Bearer ${token}`, [CLIENT_HEADER]: CLIENT }
		},
		async signIn() {
			const session = await authorize(DEFAULT_API_URL)
			if (!session) return
			await writeSession(session)
			signedIn(session)
			reloadNextUp()
		},
		async signInAgain() {
			const before = await readSession()
			const session = await authorize(DEFAULT_API_URL, { again: true })
			if (!session) return false
			await writeSession(session)
			signedIn(session)
			// The sign-in before is replaced, not kept alongside.
			if (before?.refreshToken) await revoke(before)
			return true
		},
		async signOut() {
			const session = await readSession()
			await forget()
			if (session) await revoke(session)
		},
		accountDeleted: forget,
	}
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<AuthState>({ status: "loading" })
	const [actions] = useState(() => createAuth(setState))

	useEffect(() => {
		// Whatever fails, the launch screen must give way.
		actions.load().catch(() => setState({ status: "signed-out" }))
	}, [actions])

	const auth = useMemo<Auth>(
		() => ({
			state,
			apiUrl: DEFAULT_API_URL,
			signIn: actions.signIn,
			signInAgain: actions.signInAgain,
			signOut: actions.signOut,
			accountDeleted: actions.accountDeleted,
			imageHeaders: actions.imageHeaders,
		}),
		[state, actions],
	)
	return <AuthContext value={auth}>{children}</AuthContext>
}

export function useAuth(): Auth {
	const auth = use(AuthContext)
	if (!auth) throw new Error("useAuth outside AuthProvider")
	return auth
}
