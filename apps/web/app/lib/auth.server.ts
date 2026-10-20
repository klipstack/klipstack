import { cimd } from "@better-auth/cimd"
import { fetchClientMetadataResource } from "@better-auth/cimd/node"
import { getCurrentAuthContext, queueAfterTransactionHook } from "@better-auth/core/context"
import { mcp } from "@better-auth/mcp"
import {
	API_RESOURCE_PATH,
	APP_SIGN_IN_CODE_LENGTH,
	CLI_CLIENT_ID,
	CLI_REDIRECT_URI,
	MOBILE_CLIENT_ID,
	mobileRedirectUris,
} from "@klipstack/api-contract/auth"
import {
	account,
	and,
	db,
	eq,
	jwks,
	ne,
	newId,
	oauthAccessToken,
	oauthClient,
	oauthClientAssertion,
	oauthClientResource,
	oauthConsent,
	oauthRefreshToken,
	oauthResource,
	newAccountFeatures,
	session,
	user,
	userFeatures,
	verification,
} from "@klipstack/db"
import { emailT } from "@klipstack/email"
import { fallbackLanguage, supportedLanguages } from "@klipstack/i18n"
import { describeError, logError } from "@klipstack/log"
import { betterAuth, type GenericEndpointContext } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import {
	APIError,
	addOAuthServerContext,
	createAuthMiddleware,
	getOAuthState,
	getSessionFromCtx,
	isAPIError,
} from "better-auth/api"
import { emailOTP, jwt, magicLink } from "better-auth/plugins"
import { sealAppleToken } from "./apple-tokens.server"
import {
	MAGIC_LINK_MINUTES,
	MIN_PASSWORD_LENGTH,
	OAUTH_SCOPES,
	RESET_PASSWORD_MINUTES,
	SIGN_IN_CODE_MINUTES,
	VERIFY_EMAIL_MINUTES,
	VERIFY_TO_CONTINUE_PAGE,
} from "./auth-constants"
import { authDb } from "./auth-db.server"
import { checkAuthLimit } from "./auth-limits.server"
import { consentReference, credentialClaims, revokeCredentials } from "./credential-policy.server"
import { EmailError, renderEmail, sendEmail, sendEmailInBackground } from "./email.server"
import { env, invitesRequired, oauth, welcomeFrom } from "./env.server"
import { findUsableInvite } from "./invites.server"
import {
	currentProviderCallback,
	type LinkSignup,
	pendingLinkSignup,
	pendingProviderSignup,
	signupAllowed,
} from "./signup-gate.server"

/** The MCP server's resource identifier: MCP access tokens carry it as their audience. */
export const MCP_RESOURCE = new URL("/mcp", env.APP_URL).href

/** The HTTP API's resource identifier (/api/v1/*): API access tokens carry it as their audience. */
export const API_RESOURCE = new URL(API_RESOURCE_PATH, env.APP_URL).href

// The OAuth plugin inserts the resource rows at init, but it only tolerates a concurrent insert when
// the error text says "unique", and Drizzle's wrapped error does not: two instances starting together
// (a deploy, dev reloads) crash one of them. Insert the rows first, race-free.
const startedAt = new Date()
await db
	.insert(oauthResource)
	.values(
		[MCP_RESOURCE, API_RESOURCE].map((identifier) => ({
			id: newId(),
			identifier,
			name: identifier,
			createdAt: startedAt,
			updatedAt: startedAt,
		})),
	)
	.onConflictDoNothing({ target: oauthResource.identifier })

/** The email-OTP plugin's endpoints, all closed over HTTP. */
const EMAIL_OTP_PATHS = [
	"/email-otp/send-verification-otp",
	"/email-otp/check-verification-otp",
	"/email-otp/verify-email",
	"/sign-in/email-otp",
	"/email-otp/request-password-reset",
	"/forget-password/email-otp",
	"/email-otp/reset-password",
	"/email-otp/request-email-change",
	"/email-otp/change-email",
]

/** Public native clients: PKCE, no secret, linked to the /api resource only. */
const NATIVE_CLIENT = {
	tokenEndpointAuthMethod: "none",
	applicationType: "native",
	grantTypes: ["authorization_code", "refresh_token"],
	responseTypes: ["code"],
	requirePKCE: true,
	skipConsent: false,
}

const FIRST_PARTY_CLIENTS = [
	// The CLI's loopback redirect may use any port (RFC 8252).
	{ clientId: CLI_CLIENT_ID, name: "Klipstack CLI", redirectUris: [CLI_REDIRECT_URI] },
	// The mobile app's universal link; on an http server, its reverse-domain URL scheme too.
	// No consent screen: the app signs in on its own screen, and on an https server only our signed
	// app opens the link the code comes back to (docs/security.md, "Mobile app sign-in").
	{
		clientId: MOBILE_CLIENT_ID,
		name: "Klipstack app",
		redirectUris: mobileRedirectUris(env.APP_URL),
		skipConsent: true,
	},
]

export const auth = betterAuth({
	appName: "Klipstack",
	baseURL: env.APP_URL,
	secret: env.BETTER_AUTH_SECRET,
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			await checkAuthLimit(ctx.path, ctx.body?.email, ctx.headers)
			// A sign-up started by /signup carries its checked invite through the provider, in the
			// part of the state only the server writes. The callback reads it back below.
			const signup = ctx.path === "/sign-in/social" ? pendingProviderSignup() : undefined
			if (signup?.inviteCode) await addOAuthServerContext({ invite: signup.inviteCode })
			if (signup?.app) await addOAuthServerContext({ app: true })
			// Refuse before the account lookup: failing for existing accounts only would reveal them.
			if (
				(ctx.path === "/request-password-reset" ||
					ctx.path === "/email-otp/send-verification-otp") &&
				process.env.NODE_ENV === "production" &&
				!env.RESEND_API_KEY
			)
				throw new EmailError("EMAIL_NOT_CONFIGURED", "Email delivery is not configured")
		}),
	},
	database: drizzleAdapter(authDb, {
		provider: "pg",
		schema: {
			user,
			session,
			account,
			verification,
			jwks,
			oauthClient,
			oauthResource,
			oauthClientResource,
			oauthRefreshToken,
			oauthAccessToken,
			oauthConsent,
			oauthClientAssertion,
		},
	}),
	user: {
		additionalFields: {
			locale: { type: "string", required: false, defaultValue: fallbackLanguage, input: true },
			invitedBy: { type: "string", required: false, input: false },
			prefs: { type: "json", required: false, input: false },
			// Read-only here: no sign-up, profile update or provider claim can set it. The operator
			// CLI is the only writer (scripts/admin.ts).
			role: { type: "string", required: false, defaultValue: "user", input: false },
		},
	},
	emailAndPassword: {
		enabled: true,
		minPasswordLength: MIN_PASSWORD_LENGTH,
		requireEmailVerification: false,
		resetPasswordTokenExpiresIn: RESET_PASSWORD_MINUTES * 60,
		// Whoever knew the old password, or stole a session, is signed out.
		revokeSessionsOnPasswordReset: true,
		// better-auth calls this for existing accounts only: strangers never receive mail from us.
		async sendResetPassword({ user: recipient, url }) {
			// The row carries our additional fields; better-auth types the base user only.
			const { locale } = recipient as typeof recipient & { locale?: string | null }
			const t = emailT(locale, "auth")
			const rendered = renderEmail({
				heading: t("resetPassword.emailSubject"),
				body: t("resetPassword.emailBody", { minutes: RESET_PASSWORD_MINUTES }),
				cta: { label: t("resetPassword.emailCta"), url },
				footer: t("resetPassword.emailIgnore"),
			})
			sendEmailInBackground({
				to: recipient.email,
				subject: t("resetPassword.emailSubject"),
				...rendered,
			})
		},
		// The reset link proves mailbox ownership, as a magic link does. An unverified account keeps
		// no provider link from before that proof, and counts as verified from here: a later
		// verification would otherwise remove the password just set (and its trigger revokes
		// credentials). A verified account's reset is a recovery: whoever had a session may have
		// made an API key or connected an app of their own, so those end with the sessions.
		async onPasswordReset({ user: owner }) {
			if (owner.emailVerified) {
				await db.transaction((tx) => revokeCredentials(tx, owner.id))
				return
			}
			await db.transaction(async (tx) => {
				await tx
					.delete(account)
					.where(and(eq(account.userId, owner.id), ne(account.providerId, "credential")))
				await tx.update(user).set({ emailVerified: true }).where(eq(user.id, owner.id))
			})
		},
	},
	// Verification from Settings. The link signs nobody in and removes nothing: it only counts in a
	// browser signed in to the account it names, so the mailbox and the password are in the same
	// hands. Proving the mailbox alone (a magic link, a password reset) still ends earlier access.
	emailVerification: {
		expiresIn: VERIFY_EMAIL_MINUTES * 60,
		async sendVerificationEmail({ user: recipient, token }) {
			const { locale } = recipient as typeof recipient & { locale?: string | null }
			const t = emailT(locale, "auth")
			const url = new URL("/verify-email", env.APP_URL)
			url.searchParams.set("token", token)
			const rendered = renderEmail({
				heading: t("verification.emailSubject"),
				body: t("verification.emailBody", { minutes: VERIFY_EMAIL_MINUTES }),
				cta: { label: t("verification.emailCta"), url: url.href },
				footer: t("verification.emailIgnore"),
			})
			await sendEmail({
				to: recipient.email,
				subject: t("verification.emailSubject"),
				...rendered,
			})
		},
		async beforeEmailVerification(owner) {
			// The running endpoint's context: typed as partial, complete inside an endpoint.
			const ctx = (await getCurrentAuthContext()) as GenericEndpointContext
			const current = await getSessionFromCtx(ctx)
			if (current?.user.id !== owner.id)
				throw new APIError("FORBIDDEN", {
					code: "VERIFICATION_NEEDS_SESSION",
					message: "Open this link while signed in to the account it verifies.",
				})
		},
	},
	socialProviders: {
		...(oauth.google ? { google: oauth.google } : {}),
		...(oauth.github ? { github: oauth.github } : {}),
		...(oauth.apple ? { apple: oauth.apple } : {}),
	},
	databaseHooks: {
		user: {
			create: {
				async before(data, ctx) {
					// A provider creates the user without our additional fields.
					const fromProvider = ctx?.path?.startsWith("/callback/")
					const headers = ctx?.headers ?? ctx?.request?.headers
					const locale = fromProvider && headers ? localeFromHeaders(headers) : null
					// While the welcome is on, the new account has its note and email to come.
					// (No one gives an account its prefs at sign-up: they start here.)
					const welcome = welcomeFrom
						? { prefs: { onboarding: { note: "due", email: "due" } } }
						: {}
					const extra =
						locale || welcomeFrom
							? { data: { ...(locale ? { locale } : {}), ...welcome } }
							: undefined
					// The app signs in only, whatever the sign-up mode: Apple's ID token in process
					// (/sign-in/social, closed over HTTP), Google and GitHub from its sheet.
					if (
						ctx?.path === "/sign-in/social" ||
						(fromProvider && (await getOAuthState())?.serverContext?.app === true)
					)
						throw new APIError("FORBIDDEN", {
							code: "INVITE_REQUIRED",
							message: "The app creates no account.",
						})
					if (!invitesRequired || signupAllowed()) return extra
					if (fromProvider && (await providerInviteLocked(data.email))) return extra
					throw new APIError("FORBIDDEN", {
						code: "INVITE_REQUIRED",
						message: "Sign-up requires an invite code.",
					})
				},
				// Every way in (email and invite, Google, GitHub) creates the user here. Its flags go in
				// after better-auth's own transaction, in the sign-up's (`authDb`): with the invite, they
				// commit or roll back together with the user.
				async after(created) {
					await queueAfterTransactionHook(async () => {
						await authDb
							.insert(userFeatures)
							.values(newAccountFeatures.map((feature) => ({ userId: created.id, feature })))
							.onConflictDoNothing()
					})
				},
			},
		},
		// Providers only tell us who signed in. We call none of their APIs, so their tokens are
		// not kept, but for Apple's refresh token, sealed, which revokes the sign-in when the account
		// is deleted (apple-tokens.server.ts).
		account: {
			create: {
				async before(data, ctx) {
					return { data: { ...data, ...NO_PROVIDER_TOKENS, ...(await appleToken(data, ctx)) } }
				},
			},
			update: {
				async before(data, ctx) {
					const tokens = Object.keys(NO_PROVIDER_TOKENS).filter((key) => key in data)
					return {
						data: {
							...data,
							...Object.fromEntries(tokens.map((key) => [key, null])),
							...(await appleToken(data, ctx)),
						},
					}
				},
			},
		},
	},
	session: {
		expiresIn: 60 * 60 * 24 * 30,
		updateAge: 60 * 60 * 24,
		// No cookie cache: user fields (locale, name) must be fresh on every request.
	},
	advanced: {
		database: { generateId: () => newId() },
		cookiePrefix: "klip",
		ipAddress: { ipAddressHeaders: ["x-klipstack-client-ip"] },
	},
	// The JWT plugin's session-to-JWT endpoint: OAuth clients get tokens from /oauth2/token instead.
	// Email verification: only our routes call it (settings.verify-email.ts, verify-email.ts).
	// Passwords and provider links: only Settings changes them (settings.sign-in.ts), with its own
	// checks and limits.
	disabledPaths: [
		"/token",
		"/send-verification-email",
		"/verify-email",
		"/change-password",
		"/link-social",
		"/unlink-account",
		// Provider sign-ins start on our pages (in process): over HTTP this endpoint would also take
		// an Apple ID token by itself, which works for an hour wherever it was copied. The app's
		// Apple sign-in goes through /app/sign-in, which exchanges Apple's one-time code first.
		"/sign-in/social",
		// The emailed sign-in code is the app's alone: only /app/sign-in sends and checks it (the
		// plugin's endpoints, called in process). Its other uses (verifying, resetting a password,
		// changing the email) are not offered.
		...EMAIL_OTP_PATHS,
	],
	// better-auth prints raw errors, and a failed query's message lists its parameters (tokens,
	// emails): its messages are its own text, but errors and other arguments are reduced.
	logger: {
		log(level, message: unknown, ...args) {
			// Some calls pass the error itself as the message (e.g. /list-sessions).
			const text = typeof message === "string" ? message : describeError(message)
			const extra = args.map((arg) =>
				arg instanceof Error ? describeError(arg) : `[${typeof arg}]`,
			)
			const write =
				level === "error" ? console.error : level === "warn" ? console.warn : console.log
			write(`[auth] ${text}`, ...extra)
		},
	},
	// Endpoint failures: expected API errors (401, 400, …) are answers, not log lines.
	onAPIError: {
		onError(error) {
			if (isAPIError(error)) {
				if (error.statusCode >= 500) logError("[auth] request failed", error)
				return
			}
			logError("[auth] request failed", error)
			// Answer ourselves: otherwise better-call prints the raw error, message and all. (It must
			// throw synchronously: better-auth does not await this handler.)
			if (error instanceof EmailError && error.code === "EMAIL_NOT_CONFIGURED")
				throw new APIError("SERVICE_UNAVAILABLE", {
					code: error.code,
					message: "Email delivery is not configured.",
				})
			throw new APIError("INTERNAL_SERVER_ERROR")
		},
	},
	plugins: [
		magicLink({
			expiresIn: MAGIC_LINK_MINUTES * 60,
			// A link may create its account, but only /signup/confirm can: the `user.create` hook below
			// refuses anywhere else in invite mode, and the mailer writes to strangers for /signup only.
			async sendMagicLink({ email, url, token }, ctx) {
				if (process.env.NODE_ENV === "production" && !env.RESEND_API_KEY)
					throw new EmailError("EMAIL_NOT_CONFIGURED", "Email delivery is not configured")
				const existing = await db.query.user.findFirst({
					where: eq(user.email, email.trim().toLowerCase()),
				})
				if (!existing) {
					const signup = pendingLinkSignup()
					if (signup) sendSignupLink(email, token, signup)
					return
				}
				const headers = ctx?.headers ?? ctx?.request?.headers
				const locale = (headers && localeFromHeaders(headers)) ?? fallbackLanguage
				const t = emailT(locale, "auth")
				// For an unverified account this link is also the mailbox proof that removes the
				// password and sessions: its email says so.
				const subject = t(
					existing.emailVerified ? "magicLink.emailSubject" : "verification.emailSubject",
				)
				const rendered = renderEmail({
					heading: subject,
					body: t(existing.emailVerified ? "magicLink.emailBody" : "verification.loginEmailBody", {
						minutes: MAGIC_LINK_MINUTES,
					}),
					cta: {
						label: t(existing.emailVerified ? "magicLink.emailCta" : "verification.loginEmailCta"),
						url,
					},
					footer: t("magicLink.emailIgnore"),
				})
				sendEmailInBackground({ to: email, subject, ...rendered })
			},
		}),
		// The iPhone app's emailed sign-in code, for existing accounts only. Like a magic link, it is
		// proof of the mailbox: an unverified account becomes verified, and loses the ways in it had.
		emailOTP({
			otpLength: APP_SIGN_IN_CODE_LENGTH,
			expiresIn: SIGN_IN_CODE_MINUTES * 60,
			allowedAttempts: 3,
			storeOTP: "hashed",
			disableSignUp: true,
			// Called for existing accounts only (`disableSignUp`).
			async sendVerificationOTP({ email, otp, type }) {
				if (type !== "sign-in") return
				const recipient = await db.query.user.findFirst({ where: eq(user.email, email) })
				if (!recipient) return
				const t = emailT(recipient.locale, "auth")
				const subject = t("signInCode.emailSubject")
				const body = t(recipient.emailVerified ? "signInCode.emailBody" : "signInCode.verifyBody", {
					minutes: SIGN_IN_CODE_MINUTES,
				})
				const rendered = renderEmail({
					heading: subject,
					body: `${body}\n\n${otp}`,
					footer: t("signInCode.emailIgnore"),
				})
				sendEmailInBackground({ to: email, subject, ...rendered })
			},
		}),
		// Signing keys for OAuth access and ID tokens, published at /api/auth/jwks.
		jwt({ disableSettingJwtHeader: true }),
		// Klipstack as an OAuth 2.1 authorization server (better-auth's OAuth provider, set up for MCP):
		// access tokens are bound to the /mcp resource, whose metadata it also serves, or to the
		// HTTP API's. Clients registered through their metadata document stay linked to /mcp only.
		mcp({
			loginPage: "/login",
			consentPage: "/oauth/consent",
			resource: MCP_RESOURCE,
			resources: [API_RESOURCE],
			scopes: [...OAUTH_SCOPES],
			postLogin: {
				page: VERIFY_TO_CONTINUE_PAGE,
				shouldRedirect: ({ user }) => !user.emailVerified,
				consentReferenceId: ({ user, session, scopes }) =>
					consentReference(user.id, session.id, scopes),
			},
			extensions: [credentialClaims],
		}),
		// Clients identify themselves with the HTTPS URL of a metadata document (no registration step).
		// The Node transport pins the resolved public address and refuses redirects (SSRF-safe).
		cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
	],
})

// The first-party clients, inserted directly (the provider's registration checks do not run).
// Upserted, so later changes to these fields apply on restart.
for (const { clientId, ...fields } of FIRST_PARTY_CLIENTS) {
	const client = { ...NATIVE_CLIENT, ...fields }
	await db
		.insert(oauthClient)
		.values({ id: newId(), clientId, ...client, createdAt: startedAt, updatedAt: startedAt })
		.onConflictDoUpdate({ target: oauthClient.clientId, set: { ...client, updatedAt: startedAt } })
	await db
		.insert(oauthClientResource)
		.values({ id: newId(), clientId, resourceId: API_RESOURCE, createdAt: startedAt })
		.onConflictDoNothing({ target: [oauthClientResource.clientId, oauthClientResource.resourceId] })
}

/**
 * Apple's refresh token from the web's sign-in (the provider callback, which links Settings'
 * connections too), sealed for the Services ID. The app's own Apple sign-in brings none here: its
 * token is kept by /app/sign-in.
 */
async function appleToken(
	data: { providerId?: unknown; refreshToken?: unknown },
	ctx: GenericEndpointContext | null | undefined,
): Promise<{ refreshToken?: string }> {
	if (data.providerId !== "apple" || !oauth.apple) return {}
	if (typeof data.refreshToken !== "string" || !data.refreshToken) return {}
	if (!ctx?.path?.startsWith("/callback/")) return {}
	return { refreshToken: await sealAppleToken(oauth.apple.clientId, data.refreshToken) }
}

const NO_PROVIDER_TOKENS = {
	accessToken: null,
	refreshToken: null,
	idToken: null,
	accessTokenExpiresAt: null,
	refreshTokenExpiresAt: null,
}

/**
 * Whether this provider callback carries a usable invite. It locks the invite in the callback's
 * transaction and leaves its code for the wrapper (provider-sign-in.server.ts), which consumes it
 * once the user exists.
 */
async function providerInviteLocked(email: string): Promise<boolean> {
	const callback = currentProviderCallback()
	if (!callback) return false
	const code = (await getOAuthState())?.serverContext?.invite
	const invite = typeof code === "string" ? await findUsableInvite(code, authDb) : null
	if (!invite) return false
	callback.inviteCode = invite.code
	callback.email = email
	return true
}

/**
 * The sign-up link opens /signup/confirm, a page with a button, never better-auth's GET endpoint:
 * a mail scanner that follows the link creates nothing and leaves the token usable.
 */
function sendSignupLink(email: string, token: string, { inviteCode, locale }: LinkSignup) {
	const t = emailT(locale, "auth")
	const url = new URL("/signup/confirm", env.APP_URL)
	url.searchParams.set("token", token)
	if (inviteCode) url.searchParams.set("invite", inviteCode)
	const subject = t("signupLink.emailSubject")
	const rendered = renderEmail({
		heading: subject,
		body: t("signupLink.emailBody", { minutes: MAGIC_LINK_MINUTES }),
		cta: { label: t("signupLink.emailCta"), url: url.href },
		footer: t("signupLink.emailIgnore"),
	})
	sendEmailInBackground({ to: email, subject, ...rendered })
}

function localeFromHeaders(headers: Headers): string | null {
	const cookie = headers.get("cookie") ?? ""
	const match = /(?:^|;\s*)lng=([a-zA-Z-]+)/.exec(cookie)
	const fromCookie = match?.[1]
	if (fromCookie && (supportedLanguages as readonly string[]).includes(fromCookie))
		return fromCookie
	return null
}

export type Auth = typeof auth
export type SessionData = Auth["$Infer"]["Session"]
export type AuthUser = SessionData["user"]
