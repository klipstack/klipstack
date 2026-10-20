import { loadEnv } from "@klipstack/db"
import { welcomeFrom as readWelcomeFrom } from "@klipstack/email"
import { z } from "zod"
import { appleClientSecret } from "./apple-client-secret.server"

loadEnv()

const isProd = process.env.NODE_ENV === "production"

/**
 * A dashboard link shown on /admin/system. HTTPS, no credentials, no query string, and never a
 * Better Stack heartbeat ping URL: that one is a secret, and opening it reports a backup.
 */
export const dashboardUrl = z
	.string()
	.refine((value) => {
		const url = URL.canParse(value) ? new URL(value) : null
		return (
			!!url &&
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.search &&
			!/\/api\/v\d+\/heartbeat\//.test(url.pathname)
		)
	}, "Use an https dashboard URL without credentials or a query string")
	.optional()

/** An optional value that an empty line in `.env` (`NAME=`) leaves unset. */
const optional = <T extends z.ZodType>(type: T) =>
	z.preprocess((value) => (value === "" ? undefined : value), type.optional())

const fields = z.object({
	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
	DATABASE_URL: z.string().min(1),
	BETTER_AUTH_SECRET: z
		.string()
		.min(isProd ? 32 : 1)
		.refine(
			(secret) =>
				!isProd ||
				![
					"change-me-to-a-random-string-of-at-least-32-chars",
					"dev-secret-not-for-production",
				].includes(secret),
			"Set a randomly generated auth secret in production",
		)
		.default(isProd ? "" : "dev-secret-not-for-production"),
	/**
	 * Without a trailing slash, whatever was set: code appends paths to it, and the OAuth issuer
	 * (`<APP_URL>/api/auth`) must match the tokens' exactly.
	 */
	APP_URL: z
		.string()
		.url()
		.default("http://localhost:5180")
		.transform((url) => url.replace(/\/+$/, "")),
	/** The commit this image was built from; "dev" outside a build. */
	APP_VERSION: z.string().default("dev"),
	/** `waitlist`: invite-only, and the public can ask for an invite (`/request-invite`). */
	SIGNUP_MODE: z.enum(["open", "invite", "waitlist"]).default("invite"),
	RESEND_API_KEY: z.string().optional(),
	EMAIL_FROM: z.string().default("Klipstack <hello@localhost>"),
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	GITHUB_CLIENT_ID: z.string().optional(),
	GITHUB_CLIENT_SECRET: z.string().optional(),
	STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
	STORAGE_FS_ROOT: z.string().default("./storage"),
	S3_ENDPOINT: z.string().optional(),
	S3_BUCKET: z.string().optional(),
	S3_ACCESS_KEY_ID: z.string().optional(),
	S3_SECRET_ACCESS_KEY: z.string().optional(),
	/**
	 * "1": check the API's responses against the contract even in a production build, as the e2e
	 * tests run one. Never set in production: a mismatch answers 500.
	 */
	API_CHECK_RESPONSES: z.enum(["0", "1"]).default("0"),
	/** Better Stack team pages for /admin/system, e.g. https://uptime.betterstack.com/team/t1234/monitors. */
	OPS_UPTIME_URL: dashboardUrl,
	OPS_BACKUPS_URL: dashboardUrl,
	/** Per-account caps (`lib/limits.server.ts`), the same for every account, the owner's too. */
	LIMIT_SAVES_PER_MONTH: z.coerce.number().int().positive().default(300),
	LIMIT_STORAGE_MB: z.coerce.number().int().positive().default(250),
	LIMIT_FEEDS: z.coerce.number().int().positive().default(100),
	LIMIT_EDITIONS_PER_MONTH: z.coerce.number().int().positive().default(4),
	LIMIT_SHARES_PER_MONTH: z.coerce.number().int().positive().default(100),
	/** Except AI questions: they cost money, so admins have a cap of their own. */
	LIMIT_AI_PER_MONTH: z.coerce.number().int().positive().default(100),
	LIMIT_AI_PER_MONTH_ADMIN: z.coerce.number().int().positive().default(500),
	/**
	 * The day billing starts (`@klipstack/db`'s `plan.ts`). Unset, billing is off: every account has
	 * the caps above and none lapses. From that day, new accounts have a trial with the `LIMIT_TRIAL_*`
	 * caps, older ones a free year with the `LIMIT_PAID_*` caps.
	 */
	BILLING_STARTS_AT: optional(z.coerce.date()),
	LIMIT_TRIAL_SAVES_PER_MONTH: z.coerce.number().int().positive().default(300),
	LIMIT_TRIAL_STORAGE_MB: z.coerce.number().int().positive().default(500),
	LIMIT_TRIAL_FEEDS: z.coerce.number().int().positive().default(100),
	LIMIT_TRIAL_EDITIONS_PER_MONTH: z.coerce.number().int().positive().default(4),
	LIMIT_TRIAL_SHARES_PER_MONTH: z.coerce.number().int().positive().default(50),
	LIMIT_TRIAL_AI_PER_MONTH: z.coerce.number().int().positive().default(50),
	LIMIT_PAID_SAVES_PER_MONTH: z.coerce.number().int().positive().default(2000),
	LIMIT_PAID_STORAGE_MB: z.coerce.number().int().positive().default(2048),
	LIMIT_PAID_FEEDS: z.coerce.number().int().positive().default(500),
	LIMIT_PAID_EDITIONS_PER_MONTH: z.coerce.number().int().positive().default(30),
	LIMIT_PAID_SHARES_PER_MONTH: z.coerce.number().int().positive().default(500),
	LIMIT_PAID_AI_PER_MONTH: z.coerce.number().int().positive().default(300),
	/** AI answers in the reader. Unset, the AI buttons stay hidden. */
	ANTHROPIC_API_KEY: z.string().optional(),
	/** TypeSafe's key, for Jev: automatic topics need it and Anthropic's. */
	TYPESAFE_API_KEY: z.string().optional(),
	/**
	 * "1": a fixed answer instead of a provider, for the e2e tests and work without a key. "demo":
	 * longer answers citing the article, for the demo app (`pnpm orb:app`).
	 */
	AI_FAKE: z.enum(["0", "1", "demo"]).default("0"),
	/**
	 * The Apple team and bundle ID of the iPhone app that may open this server's links (universal
	 * links, `/.well-known/apple-app-site-association`). Both, or the file is not found. Sign in
	 * with Apple needs the team ID too, app or not.
	 */
	APPLE_TEAM_ID: optional(z.string().regex(/^[A-Z0-9]{10}$/, "Use the 10-character Apple team ID")),
	APPLE_BUNDLE_ID: optional(
		z.string().regex(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, "Use a bundle ID like com.example.app"),
	),
	/**
	 * Sign in with Apple, with APPLE_TEAM_ID: the Services ID the web signs in as, and the Sign in
	 * with Apple key that signs its client secret (its key ID, and the `.p8` file on one line, its
	 * line breaks written as \n). All three, or Apple sign-in is off.
	 */
	APPLE_SERVICES_ID: optional(
		z.string().regex(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, "Use a Services ID like com.example.web"),
	),
	APPLE_KEY_ID: optional(z.string().regex(/^[A-Z0-9]{10}$/, "Use the 10-character key ID")),
	APPLE_PRIVATE_KEY: optional(
		z.string().includes("PRIVATE KEY", { message: "Use the .p8 file's text" }),
	),
	/**
	 * The SuppyHQ account behind Contact support in the sidebar (`components/support-panel.tsx`).
	 * Unset, the app has no link to SuppyHQ.
	 */
	SUPPYHQ_TENANT: optional(
		z.string().regex(/^[a-z0-9-]+$/, "Use the tenant from SuppyHQ's snippet"),
	),
})

const schema = fields.superRefine((value, ctx) => {
	const apple = [value.APPLE_SERVICES_ID, value.APPLE_KEY_ID, value.APPLE_PRIVATE_KEY]
	// Half a configuration would hide the button without a word: refuse to start instead.
	if (apple.some(Boolean) && !(apple.every(Boolean) && value.APPLE_TEAM_ID))
		ctx.addIssue({
			code: "custom",
			path: ["APPLE_SERVICES_ID"],
			message:
				"Set APPLE_TEAM_ID, APPLE_SERVICES_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY together for Sign in with Apple",
		})
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
	console.error("Invalid environment:", z.treeifyError(parsed.error))
	throw new Error("Invalid environment variables")
}

export const env = parsed.data

/** Whether a new account needs an invite: in every mode but `open`, the wait list included. */
export const invitesRequired = env.SIGNUP_MODE !== "open"

/**
 * How the server reaches itself without going out through the proxy: in production the Node server
 * listens on PORT inside the container.
 */
export const selfUrl =
	isProd && process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : env.APP_URL

export const oauth = {
	google:
		env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
			? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
			: null,
	github:
		env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
			? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
			: null,
	apple: appleOptions(),
}

function appleOptions() {
	const { APPLE_TEAM_ID, APPLE_SERVICES_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = env
	if (!APPLE_TEAM_ID || !APPLE_SERVICES_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) return null
	const secret = appleClientSecret({
		teamId: APPLE_TEAM_ID,
		clientId: APPLE_SERVICES_ID,
		keyId: APPLE_KEY_ID,
		privateKey: APPLE_PRIVATE_KEY,
	})
	return {
		clientId: APPLE_SERVICES_ID,
		// Read at each use: a secret lasts six months at most, and is renewed while the server runs.
		get clientSecret() {
			return secret()
		},
		// The ID tokens Apple issues to the web (the Services ID) and to our iPhone app (its bundle
		// ID), which signs in with Apple's own sheet.
		audience: [APPLE_SERVICES_ID, ...(env.APPLE_BUNDLE_ID ? [env.APPLE_BUNDLE_ID] : [])],
	}
}

/**
 * The iPhone app as Apple's client (its bundle ID), with Sign in with Apple on: the server exchanges
 * the codes Apple's sheet gives the app, and revokes them, with this client's own secret. Null
 * without Apple or the bundle ID.
 */
export const appleApp = appleAppOptions()

function appleAppOptions() {
	const { APPLE_TEAM_ID, APPLE_BUNDLE_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = env
	if (!oauth.apple || !APPLE_TEAM_ID || !APPLE_BUNDLE_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY)
		return null
	const secret = appleClientSecret({
		teamId: APPLE_TEAM_ID,
		clientId: APPLE_BUNDLE_ID,
		keyId: APPLE_KEY_ID,
		privateKey: APPLE_PRIVATE_KEY,
	})
	return {
		clientId: APPLE_BUNDLE_ID,
		get clientSecret() {
			return secret()
		},
	}
}

/**
 * Who signs the welcome note and email for new accounts, or null: no welcome. A malformed setting
 * stops the server here.
 */
export const welcomeFrom = readWelcomeFrom(process.env)

/** Short form of the deployed commit, as shown in Settings. */
export const appVersion = /^[0-9a-f]{40}$/.test(env.APP_VERSION)
	? env.APP_VERSION.slice(0, 7)
	: env.APP_VERSION
