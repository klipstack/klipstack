import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { buffer } from "node:stream/consumers"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { config } from "dotenv"
import { assertLocal, EMAIL as DEMO_EMAIL } from "./demo/local"
import { DOMAIN, isThrowaway, newAccount } from "./dev-account/names"

const root = fileURLToPath(new URL("../../../", import.meta.url))
config({ path: resolve(root, ".env"), quiet: true })

const usage = `Usage: pnpm --filter @klipstack/web dev-account <command> [options]
  create            A throwaway account on the local database, with copies of demo articles.
                    Prints its address, password and an API key (klip_…).
    --app-token     Also sign the iPhone app in: print a refresh token for apps/mobile/.env.local
    --articles N    How many of the demo account's newest articles to copy (default 20)
    --feature NAME  Turn on a feature in testing (repeatable): ai, topics
    --name LABEL    The address's local part (default dev-<timestamp>)
  app-token EMAIL   Sign the iPhone app in to a throwaway account: a new refresh token.
  list              The throwaway accounts on the local database.
  delete EMAIL      Delete one throwaway account and everything it owns.
  delete --all      Delete every throwaway account.
Only a loopback database is accepted. Accounts live at @${DOMAIN}.`

const PASSWORD = "local-throwaway-only"
const ASSET_IN_HTML = /\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		articles: { type: "string", default: "20" },
		feature: { type: "string", multiple: true, default: [] },
		name: { type: "string" },
		all: { type: "boolean" },
		"app-token": { type: "boolean" },
		help: { type: "boolean", short: "h" },
	},
})
if (values.help) {
	console.log(usage)
	process.exit(0)
}
// Before any import that opens the database or storage.
assertLocal(process.env)

const { account, and, assets, db, desc, documents, documentVersions, eq, isNotNull, isNull, like } =
	await import("@klipstack/db")
const { isFeatureFlag, pool, user, userFeatures } = await import("@klipstack/db")
const { assetKey, getStorage } = await import("@klipstack/storage")
const { hashPassword } = await import("better-auth/crypto")
const { createApiKey } = await import("../app/services/api-keys.server")
const { deleteAccount } = await import("../app/services/account.server")
const { appToken } = await import("./dev-account/app-token")

async function create() {
	const count = Number(values.articles)
	if (!Number.isInteger(count) || count < 0) throw new Error("--articles takes a whole number")
	const features = [...new Set(values.feature)].map((feature) => {
		if (!isFeatureFlag(feature)) throw new Error(`Unknown feature "${feature}"`)
		return feature
	})
	const demo = await db.query.user.findFirst({ where: eq(user.email, DEMO_EMAIL) })
	if (!demo) throw new Error(`No demo account (${DEMO_EMAIL}): run pnpm demo:seed first`)
	const { id, email } = newAccount(values.name)
	if (await db.query.user.findFirst({ where: eq(user.email, email) }))
		throw new Error(`${email} exists already`)

	const sources = await db
		.select({ doc: documents, version: documentVersions })
		.from(documents)
		.innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
		.where(
			and(
				eq(documents.userId, demo.id),
				eq(documents.status, "ready"),
				isNull(documents.deletedAt),
				isNotNull(documents.currentVersionId),
			),
		)
		.orderBy(desc(documents.createdAt))
		.limit(count)

	// Each image is copied to the new account's own key: deleting it (here or in Settings) removes
	// its files, and must never remove the demo account's.
	const assetIds = new Set<string>()
	for (const { doc, version } of sources) {
		if (doc.leadImageAssetId) assetIds.add(doc.leadImageAssetId)
		for (const [, assetId] of version.html.matchAll(ASSET_IN_HTML)) assetIds.add(assetId!)
	}
	const storage = getStorage()
	const assetMap = new Map<string, string>()
	const newAssets: (typeof assets.$inferInsert)[] = []
	for (const assetId of assetIds) {
		const asset = await db.query.assets.findFirst({
			where: and(eq(assets.id, assetId), eq(assets.userId, demo.id)),
		})
		const object = asset && (await storage.get(asset.storageKey))
		if (!asset || !object) continue
		const ext = asset.storageKey.split(".").pop() ?? "webp"
		const key = assetKey(id, asset.sha256, ext)
		await storage.put(key, await buffer(object.body), asset.contentType)
		const copy = randomUUID()
		assetMap.set(assetId, copy)
		newAssets.push({ ...asset, id: copy, userId: id, storageKey: key, createdAt: new Date() })
	}

	const password = await hashPassword(PASSWORD)
	// Without the account row, `delete` can't find the copied files: remove them if this fails.
	await db
		.transaction(async (tx) => {
			await tx.insert(user).values({ id, email, name: "Throwaway", emailVerified: true })
			await tx.insert(account).values({
				id: randomUUID(),
				accountId: id,
				userId: id,
				providerId: "credential",
				password,
			})
			if (features.length)
				await tx.insert(userFeatures).values(features.map((feature) => ({ userId: id, feature })))
			if (newAssets.length) await tx.insert(assets).values(newAssets)
			for (const { doc, version } of sources) {
				const documentId = randomUUID()
				const versionId = randomUUID()
				const lead = doc.leadImageAssetId ? assetMap.get(doc.leadImageAssetId) : undefined
				// Unread, in the inbox, without notes: a fresh library with the demo's articles.
				await tx.insert(documents).values({
					id: documentId,
					userId: id,
					type: doc.type,
					sourceUrl: doc.sourceUrl,
					fetchUrl: doc.fetchUrl,
					canonicalUrl: doc.canonicalUrl,
					urlHash: doc.urlHash,
					title: doc.title,
					author: doc.author,
					siteName: doc.siteName,
					description: doc.description,
					language: doc.language,
					wordCount: doc.wordCount,
					readingMinutes: doc.readingMinutes,
					publishedAt: doc.publishedAt,
					leadImageAssetId: lead ?? null,
					leadImageUrl: lead ? null : doc.leadImageUrl,
					status: "ready",
					captureSource: doc.captureSource,
					search: doc.search,
					createdAt: doc.createdAt,
				})
				await tx.insert(documentVersions).values({
					id: versionId,
					documentId,
					version: 1,
					html: version.html.replace(
						ASSET_IN_HTML,
						(match, assetId: string) => `/assets/${assetMap.get(assetId) ?? assetId}`,
					),
					text: version.text,
					textHash: version.textHash,
					extractor: version.extractor,
					extractorVersion: version.extractorVersion,
					imagesDone: true,
				})
				await tx
					.update(documents)
					.set({ currentVersionId: versionId })
					.where(eq(documents.id, documentId))
			}
		})
		.catch(async (error: unknown) => {
			await Promise.allSettled(newAssets.map((asset) => storage.delete(asset.storageKey)))
			throw error
		})
	const key = await createApiKey(id, "dev-account")
	console.log(`email     ${email}`)
	console.log(`password  ${PASSWORD}`)
	console.log(`articles  ${sources.length}`)
	// Images live in STORAGE_FS_ROOT, one per checkout: a new worktree has none of the demo's.
	console.log(`images    ${newAssets.length} of ${assetIds.size}`)
	if (features.length) console.log(`features  ${features.join(", ")}`)
	console.log(`api key   ${key.raw}`)
	console.log(`delete    pnpm --filter @klipstack/web dev-account delete ${email}`)
	if (values["app-token"]) await printAppToken(email)
}

/**
 * The iPhone app's AI and account deletion answer only the app's own OAuth tokens, never an API
 * key. A development build signs in with this refresh token instead of the sign-in sheet.
 */
async function printAppToken(email: string) {
	const { refreshToken } = await appToken(email, PASSWORD)
	console.log(`app token EXPO_PUBLIC_APP_REFRESH_TOKEN=${refreshToken}`)
	console.log("          (apps/mobile/.env.local, then pnpm start --clear; good for one sign-in)")
}

async function issueAppToken() {
	const email = positionals[1]?.toLowerCase()
	if (!email || positionals.length !== 2) throw new Error("app-token takes one EMAIL")
	if (!(await throwaways()).some((row) => row.email === email))
		throw new Error(`No throwaway account ${email}`)
	await printAppToken(email)
}

async function throwaways() {
	const rows = await db
		.select({ id: user.id, email: user.email, createdAt: user.createdAt })
		.from(user)
		.where(like(user.email, `%@${DOMAIN}`))
	return rows.filter(isThrowaway)
}

async function list() {
	const rows = await throwaways()
	if (!rows.length) console.log("No throwaway accounts.")
	for (const row of rows) console.log(`${row.email}  ${row.createdAt.toISOString()}`)
}

async function remove() {
	const email = positionals[1]?.toLowerCase()
	if (!values.all === !email) throw new Error("delete takes one EMAIL, or --all")
	const rows = (await throwaways()).filter((row) => values.all || row.email === email)
	if (email && !rows.length) throw new Error(`No throwaway account ${email}`)
	for (const row of rows) {
		await deleteAccount(row.id)
		console.log(`Deleted ${row.email}`)
	}
	if (!rows.length) console.log("No throwaway accounts.")
}

const command = positionals[0]
try {
	if (command === "create" && positionals.length === 1) await create()
	else if (command === "list" && positionals.length === 1) await list()
	else if (command === "app-token") await issueAppToken()
	else if (command === "delete") await remove()
	else throw new Error(usage)
} catch (error) {
	console.error(error instanceof Error && error.message ? error.message : error)
	process.exitCode = 1
} finally {
	await pool.end()
}
