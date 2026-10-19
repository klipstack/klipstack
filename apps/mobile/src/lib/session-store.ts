import * as SecureStore from "expo-secure-store"

/**
 * The signed-in session, kept as one JSON keychain item. The share extension
 * (targets/share/ShareViewController.swift) reads and refreshes the same item, so the service,
 * key, access group and field names must match there.
 */
export type Session = {
	apiUrl: string
	accessToken: string
	refreshToken: string
	/** Seconds since the epoch. */
	expiresAt: number
}

export const APP_GROUP = "group.com.klipstack"

const KEY = "session"
const OPTIONS: SecureStore.SecureStoreOptions = {
	keychainService: "klipstack",
	accessGroup: APP_GROUP,
	keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
}

export async function readSession(): Promise<Session | null> {
	const raw = await SecureStore.getItemAsync(KEY, OPTIONS)
	if (!raw) return null
	try {
		return JSON.parse(raw) as Session
	} catch {
		return null
	}
}

export async function writeSession(session: Session): Promise<void> {
	await SecureStore.setItemAsync(KEY, JSON.stringify(session), OPTIONS)
}

export async function clearSession(): Promise<void> {
	await SecureStore.deleteItemAsync(KEY, OPTIONS)
}

const DEV_SEED_KEY = "dev-app-refresh-token"

/**
 * Development builds: whether the session was already started from this refresh token
 * (`DEV_APP_REFRESH_TOKEN`). The server rotates it at the first refresh, so starting from it again
 * at the next launch would sign the app out.
 */
export async function seededFrom(refreshToken: string): Promise<boolean> {
	return (await SecureStore.getItemAsync(DEV_SEED_KEY)) === refreshToken
}

export async function markSeeded(refreshToken: string): Promise<void> {
	await SecureStore.setItemAsync(DEV_SEED_KEY, refreshToken)
}
