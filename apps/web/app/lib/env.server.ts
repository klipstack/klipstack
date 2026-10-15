import { loadEnv } from "@klipstack/db"
import { z } from "zod"

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

const schema = z.object({
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
	/** Except AI questions: they cost money, so admins have a cap of their own. */
	LIMIT_AI_PER_MONTH: z.coerce.number().int().positive().default(100),
	LIMIT_AI_PER_MONTH_ADMIN: z.coerce.number().int().positive().default(500),
	/** AI answers in the reader. Unset, the AI buttons stay hidden. */
	ANTHROPIC_API_KEY: z.string().optional(),
	/** TypeSafe's key, for Jev: automatic topics need it and Anthropic's. */
	TYPESAFE_API_KEY: z.string().optional(),
	/**
	 * "1": a fixed answer instead of a provider, for the e2e tests and work without a key. "demo":
	 * longer answers citing the article, for the demo app (`pnpm orb:app`).
	 */
	AI_FAKE: z.enum(["0", "1", "demo"]).default("0"),
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
}

/** Short form of the deployed commit, as shown in Settings. */
export const appVersion = /^[0-9a-f]{40}$/.test(env.APP_VERSION)
	? env.APP_VERSION.slice(0, 7)
	: env.APP_VERSION
