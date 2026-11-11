import {
	and,
	db,
	eq,
	type KeyProvider,
	type KeyResult,
	keyChecks,
	keyProviders,
	sql,
	user,
} from "@klipstack/db"
import { type Email, emailT, renderEmail, supportedLocale } from "@klipstack/email"
import { getStorage, type Storage } from "@klipstack/storage"
import { log } from "../log"
import { appUrl, defaultSend } from "../mail"

/** Asks one provider whether it accepts the configured key. */
export type KeyProbe = () => Promise<KeyResult>
export type KeyProbes = Record<KeyProvider, KeyProbe>

const TIMEOUT_MS = 10_000
/** An object that is never written: reading it shows whether the key may read the bucket. */
const MISSING_OBJECT = "key-check/missing"

/**
 * One free request per provider: a model list, the key list, a read of a missing object. None
 * spends tokens or sends anything. Only a clear refusal of the key (401, 403) is `rejected`;
 * anything else, a timeout or an outage, is `unchecked`.
 */
export function probesFromEnv(
	env: Record<string, string | undefined>,
	fetchFn: typeof fetch = fetch,
	storage?: Pick<Storage, "get">,
): KeyProbes {
	const request = (url: string, headers: Record<string, string>) =>
		fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
	const byStatus = (status: number): KeyResult =>
		status === 200 ? "working" : status === 401 || status === 403 ? "rejected" : "unchecked"
	return {
		anthropic: async () => {
			const key = env.ANTHROPIC_API_KEY
			if (!key) return "unset"
			const response = await request("https://api.anthropic.com/v1/models", {
				"x-api-key": key,
				"anthropic-version": "2023-06-01",
			})
			return byStatus(response.status)
		},
		typesafe: async () => {
			const key = env.TYPESAFE_API_KEY
			if (!key) return "unset"
			const response = await request("https://api.typesafe.ai/v1/models", {
				authorization: `Bearer ${key}`,
			})
			return byStatus(response.status)
		},
		resend: async () => {
			const key = env.RESEND_API_KEY
			if (!key) return "unset"
			const response = await request("https://api.resend.com/api-keys", {
				authorization: `Bearer ${key}`,
			})
			// A send-only key (the right kind for production) may not list keys: Resend says so with
			// `restricted_api_key`, which proves the key exists. A deleted or wrong key is a 400.
			if (response.status === 400 || response.status === 401) {
				const body = (await response.json().catch(() => ({}))) as { name?: string }
				if (body.name === "restricted_api_key") return "working"
				if (body.name === "validation_error" || response.status === 401) return "rejected"
				// Another 400, or a proxy's page: not an answer about the key.
				return "unchecked"
			}
			return byStatus(response.status)
		},
		storage: async () => {
			if (env.STORAGE_DRIVER !== "s3") return "unset"
			try {
				await (storage ?? getStorage()).get(MISSING_OBJECT)
				return "working"
			} catch (error) {
				const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
					?.httpStatusCode
				return status === 401 || status === 403 ? "rejected" : "unchecked"
			}
		},
	}
}

/**
 * Daily, and when the worker starts: checks each provider's key and records the result for
 * /admin/system. When a key is newly rejected, emails every verified admin once; the email names
 * the providers, never a key. The admins hear again only after the key worked (or was unset) in
 * between. An unclear answer changes nothing about that. A failed email is tried again at the next
 * check, to every admin: one may get it twice, never not at all. When the rejected key is Resend's
 * own, only the page and the log can tell. The queue runs one check at a time (`stately`), so two
 * workers starting together don't both send.
 */
export async function handleKeyCheck({
	probes = probesFromEnv(process.env),
	send = defaultSend,
}: {
	probes?: KeyProbes
	send?: (email: Email) => Promise<void>
} = {}): Promise<Record<KeyProvider, KeyResult>> {
	const results = {} as Record<KeyProvider, KeyResult>
	await Promise.all(
		keyProviders.map(async (provider) => {
			try {
				results[provider] = await probes[provider]()
			} catch (error) {
				log.warn("key check: no answer", { provider, error })
				results[provider] = "unchecked"
			}
		}),
	)

	const unalerted: KeyProvider[] = []
	for (const provider of keyProviders) {
		const result = results[provider]
		const clears = result === "working" || result === "unset"
		const [row] = await db
			.insert(keyChecks)
			.values({ provider, result, checkedAt: new Date() })
			.onConflictDoUpdate({
				target: keyChecks.provider,
				set: { result, checkedAt: sql`now()`, ...(clears ? { alertedAt: null } : {}) },
			})
			.returning({ alertedAt: keyChecks.alertedAt })
		if (result === "rejected" && !row?.alertedAt) unalerted.push(provider)
	}

	const rejected = keyProviders.filter((provider) => results[provider] === "rejected")
	if (rejected.length > 0) log.warn("key check: rejected", { providers: rejected.join(",") })
	if (unalerted.length > 0) await alert(unalerted, send)
	return results
}

async function alert(providers: KeyProvider[], send: (email: Email) => Promise<void>) {
	const admins = await db
		.select({ email: user.email, locale: user.locale })
		.from(user)
		.where(and(eq(user.role, "admin"), eq(user.emailVerified, true)))
	if (admins.length === 0) {
		log.warn("key check: a key is rejected, but no verified admin to tell")
		return
	}
	const url = new URL("/admin/system", appUrl()).href
	try {
		for (const admin of admins) {
			const t = emailT(admin.locale, "admin")
			const names = new Intl.ListFormat(supportedLocale(admin.locale), {
				type: "conjunction",
			}).format(providers.map((provider) => t(`system.keyProvider.${provider}`)))
			const subject = t("keyCheck.subject")
			const rendered = renderEmail(
				{
					heading: subject,
					body: t("keyCheck.body", { providers: names, count: providers.length }),
					cta: { label: t("keyCheck.cta"), url },
					footer: t("keyCheck.footer"),
				},
				appUrl(),
			)
			await send({ to: admin.email, subject, ...rendered })
		}
	} catch (error) {
		log.error("key check: the alert email failed, will try at the next check", { error })
		return
	}
	await db
		.update(keyChecks)
		.set({ alertedAt: sql`now()` })
		.where(sql`${keyChecks.provider} = any(${sql.param(providers)}::text[])`)
}
