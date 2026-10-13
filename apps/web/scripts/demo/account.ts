import { randomUUID } from "node:crypto"
import { gzipSync } from "node:zlib"
import { canonicalText } from "@klipstack/anchor"
import {
	account,
	and,
	assets,
	db,
	documentRaw,
	documents,
	documentVersions,
	eq,
	highlights,
	or,
	pool,
	readingCompletions,
	user,
} from "@klipstack/db"
import { extractArticle, urlHash, type ExtractedArticle } from "@klipstack/extract"
import { getStorage } from "@klipstack/storage"
import { hashPassword } from "better-auth/crypto"
import { JSDOM } from "jsdom"
import { ingestImage } from "../../../worker/src/images"
import { handleImages } from "../../../worker/src/jobs/images"
import { publishExtraction } from "../../../worker/src/publish"
import { createSavedSearch } from "../../app/commands/saved-searches.server"
import { insertTitle } from "../../app/lib/note-links"
import { setNote } from "../../app/services/documents.server"
import { createHighlight } from "../../app/services/highlights.server"
import { listSavedSearches } from "../../app/services/saved-searches.server"
import { changeTags } from "../../app/services/tags.server"
import { cachedImage, getBlob, hash, imageUrls, loadCapture, type Capture } from "./cache"
import { prepareFeeds } from "./feed-cache"
import { assertFeedOwnership, removeDemoFeeds, seedFeed } from "./feeds"
import { planHighlights } from "./highlights"
import { assertOwned, EMAIL, loadState, newState, PASSWORD, saveState, type State } from "./local"
import { articlePlan, searches } from "./profile"
import { verifyDemo } from "./verify"

export interface DemoOptions {
	command: "seed" | "reset" | "verify"
	cache: string
	database: string
	storage: string
	urls: string[]
	feedUrls: string[]
	seed?: string
	date?: string
	dryRun: boolean
}
export interface Prepared {
	capture: Capture
	article: ExtractedArticle
	captureHash: string
	plan: ReturnType<typeof articlePlan>
}

export async function prepareCorpus(
	options: Pick<DemoOptions, "cache" | "urls">,
	state: State,
	feedArticles = new Set<string>(),
): Promise<Prepared[]> {
	const prepared: Prepared[] = []
	for (const url of options.urls) {
		const capture = await loadCapture(options.cache, url)
		if (!capture) {
			console.log(`No capture, skipped: ${url}`)
			continue
		}
		const html = (await getBlob(options.cache, capture.page)).toString("utf8")
		const article = await extractArticle({ html, url: capture.page.finalUrl })
		for (const image of Object.values(capture.images))
			if (!("error" in image)) await getBlob(options.cache, image)
		for (const image of imageUrls(article.html, article.leadImageUrl))
			if (!capture.images[image])
				throw new Error(`Extraction now uses an uncached image; run demo:capture --refresh: ${url}`)
		prepared.push({
			capture,
			article,
			captureHash: hash(JSON.stringify(capture)),
			plan: articlePlan(
				url,
				article.title,
				state.seed,
				state.date,
				state.documents[url]?.source === "feed" || (!state.documents[url] && feedArticles.has(url)),
			),
		})
	}
	if (!prepared.length)
		throw new Error("No captured articles available. Run pnpm demo:capture first")
	return prepared
}

/** No queued work is needed: use the worker's publication and image stages directly. */
async function insertCapture(cache: string, state: State, item: Prepared) {
	const entry = state.documents[item.capture.url]!
	const existing = await db.query.documents.findFirst({ where: eq(documents.id, entry.id) })
	if (existing) {
		if (existing.userId !== state.userId || existing.sourceUrl !== item.capture.url)
			throw new Error("Demo document ownership mismatch")
		if (!existing.currentVersionId) throw new Error("Incomplete demo document; use demo:reset")
		return existing.currentVersionId
	}
	return db.transaction(async (tx) => {
		const [doc] = await tx
			.insert(documents)
			.values({
				id: entry.id,
				userId: state.userId,
				sourceUrl: item.capture.url,
				urlHash: urlHash(item.capture.url),
				captureSource: entry.source ?? "web",
				createdAt: item.plan.dates.createdAt,
			})
			.returning()
		const [raw] = await tx
			.insert(documentRaw)
			.values({
				documentId: doc!.id,
				rawHtml: gzipSync(await getBlob(cache, item.capture.page)),
				finalUrl: item.capture.page.finalUrl,
				httpStatus: item.capture.page.status,
				contentType: item.capture.page.contentType,
				source: "fetch",
				fetchedAt: item.plan.dates.createdAt,
			})
			.returning({ id: documentRaw.id })
		const versionId = await publishExtraction(
			tx,
			doc!,
			raw!.id,
			item.article,
			item.capture.page.finalUrl,
		)
		if (!versionId) throw new Error("Demo extraction was superseded")
		await tx
			.update(documentVersions)
			.set({ createdAt: item.plan.dates.createdAt })
			.where(eq(documentVersions.id, versionId))
		return versionId
	})
}
async function replayImages(cache: string, item: Prepared, userId: string, versionId: string) {
	await handleImages(
		{ data: { versionId } },
		{
			ingestImage: async (input) => {
				const cached = await cachedImage(cache, item.capture, input.url)
				if (!cached) return null
				return ingestImage(input, async () => cached)
			},
		},
	)
	const version = await db.query.documentVersions.findFirst({
		where: eq(documentVersions.id, versionId),
	})
	if (!version?.imagesDone) throw new Error("Demo image processing did not finish")
	// Failed and over-limit images have no local bytes. Leave alt text, never a browser network request.
	const dom = new JSDOM(`<body>${version.html}</body>`)
	for (const img of dom.window.document.querySelectorAll("img")) {
		if (!img.getAttribute("src")?.startsWith("/assets/")) img.removeAttribute("src")
		img.removeAttribute("srcset")
	}
	for (const source of dom.window.document.querySelectorAll("source"))
		source.removeAttribute("srcset")
	const body = dom.window.document.body
	if (canonicalText(body) !== version.text)
		throw new Error("Offline image rewrite changed article text")
	await db
		.update(documentVersions)
		.set({ html: body.innerHTML })
		.where(eq(documentVersions.id, versionId))
	dom.window.close()
	// Source URLs stay in the corpus; cards use local assets exclusively in the demo.
	await db
		.update(documents)
		.set({ leadImageUrl: null })
		.where(and(eq(documents.currentVersionId, versionId), eq(documents.userId, userId)))
}

async function applyHistory(state: State, item: Prepared, all: Prepared[]) {
	const id = state.documents[item.capture.url]!.id
	const { plan } = item
	await changeTags({ userId: state.userId, documentIds: [id], add: plan.tags })
	let note = plan.note
	const related = plan.related
		? all.find((other) => other.capture.url.includes(plan.related!) && other.plan.state !== "trash")
		: undefined
	if (note && related)
		note += `\n\nRelated: [${insertTitle(related.article.title)}](/read/${state.documents[related.capture.url]!.id})`
	if (note) await setNote(state.userId, id, note)
	const planned =
		state.documents[item.capture.url]?.source === "feed"
			? []
			: planHighlights({
					...item.article,
					url: item.capture.url,
					seed: state.seed,
					date: state.date,
				})
	for (const highlight of planned) {
		let existing = await db.query.highlights.findFirst({
			columns: { search: false },
			where: and(
				eq(highlights.documentId, id),
				eq(highlights.startOffset, highlight.start),
				eq(highlights.endOffset, highlight.end),
				eq(highlights.exact, highlight.exact),
			),
		})
		if (!existing) {
			const created = await createHighlight({
				userId: state.userId,
				documentId: id,
				input: highlight,
			})
			if (!created.ok) throw new Error(`Cannot anchor demo highlight: ${created.error}`)
			existing = created.highlight
		}
		await db
			.update(highlights)
			.set({ createdAt: highlight.createdAt, updatedAt: highlight.createdAt, note: highlight.note })
			.where(eq(highlights.id, existing.id))
	}
	await db.transaction(async (tx) => {
		await tx.update(documents).set(plan.dates).where(eq(documents.id, id))
		if (plan.dates.readAt)
			await tx
				.insert(readingCompletions)
				.values({
					documentId: id,
					userId: state.userId,
					cycle: 0,
					completedAt: plan.dates.readAt,
					source: "legacy",
				})
				.onConflictDoNothing({ target: [readingCompletions.documentId, readingCompletions.cycle] })
	})
}

async function createAccount(state: State) {
	// Standard credential format, deliberately no email delivery, session, invite, or admin grant.
	const password = await hashPassword(PASSWORD)
	const createdAt = new Date(Date.parse(state.date) - 125 * 86_400_000)
	await db.transaction(async (tx) => {
		await tx.insert(user).values({
			id: state.userId,
			email: state.email,
			name: "Alex Morgan",
			emailVerified: true,
			role: "user",
			locale: "en",
			prefs: { font: "serif", fontSize: "md", width: "normal", theme: "system" },
			createdAt,
			updatedAt: createdAt,
		})
		await tx.insert(account).values({
			id: randomUUID(),
			accountId: state.userId,
			userId: state.userId,
			providerId: "credential",
			password,
			createdAt,
			updatedAt: createdAt,
		})
	})
}

async function assertNoPendingJobs(userId: string) {
	const exists = await pool.query("select to_regclass('pgboss.job') as name")
	if (!exists.rows[0]?.name) return
	const jobs = await pool.query(
		`select count(*)::int as n from pgboss.job j where j.state in ('created', 'retry', 'active') and (j.data->>'userId' = $1 or j.data->>'documentId' in (select id::text from documents where user_id = $1) or j.data->>'feedId' in (select feed_id::text from subscriptions where user_id = $1) or j.data->>'versionId' in (select v.id::text from document_versions v join documents d on d.id = v.document_id where d.user_id = $1))`,
		[userId],
	)
	if (jobs.rows[0].n)
		throw new Error(
			"Demo account has pending jobs. Let the worker finish before seeding or resetting",
		)
}

export async function runDemo(options: DemoOptions) {
	const lock = await pool.connect()
	let locked = false
	try {
		const result = await lock.query(
			"select pg_try_advisory_lock(hashtext('klipstack-demo-reader')) as locked",
		)
		locked = result.rows[0].locked
		if (!locked) throw new Error("Another demo command is running for this database")
		const saved = await loadState(options.cache, options.database, options.storage)
		const matches = await db
			.select({ id: user.id, email: user.email })
			.from(user)
			.where(saved ? or(eq(user.email, EMAIL), eq(user.id, saved.userId)) : eq(user.email, EMAIL))
		assertOwned(saved, matches)
		if (options.command === "verify") {
			if (!saved || !matches.length) throw new Error("Demo account does not exist; run demo:seed")
			console.log(JSON.stringify(await verifyDemo(saved), null, 2))
			return
		}
		const state =
			saved ??
			newState(
				options.database,
				options.storage,
				options.seed ?? "klipstack-reader-v1",
				options.date ?? new Date().toISOString().slice(0, 10),
			)
		if (
			options.command === "seed" &&
			((options.seed && options.seed !== state.seed) ||
				(options.date && options.date !== state.date))
		)
			throw new Error("Changing the seed or date requires demo:reset")
		if (options.command === "reset") {
			state.seed = options.seed ?? state.seed
			state.date = options.date ?? state.date
		}
		await assertNoPendingJobs(state.userId)
		await assertFeedOwnership(state)
		// Complete preflight before deleting an existing account or creating a new one.
		const preparedFeeds = await prepareFeeds(options.cache, options.feedUrls)
		const feedArticles = new Set(
			preparedFeeds.flatMap((item) => (item.capture.savedUrl ? [item.capture.savedUrl] : [])),
		)
		const prepared = await prepareCorpus(
			{ ...options, urls: [...new Set([...options.urls, ...feedArticles])] },
			options.command === "reset" ? { ...state, documents: {} } : state,
			feedArticles,
		)
		if (options.command === "seed")
			for (const item of preparedFeeds) {
				const entry = state.feeds[item.capture.url]
				if (entry && entry.captureHash !== item.captureHash)
					throw new Error("A feed capture changed; use demo:reset to apply it")
			}
		if (options.command === "seed")
			for (const item of prepared) {
				const entry = state.documents[item.capture.url]
				if (entry && entry.captureHash !== item.captureHash)
					throw new Error("A capture changed; use demo:reset to apply it")
			}
		if (options.dryRun) {
			console.log(
				`${options.command}: ${state.email}, ${prepared.length} captured articles, ${preparedFeeds.length} feed snapshots, base date ${state.date}, seed ${state.seed}. ${matches.length ? "Existing owned account" : "New account"}. No changes made.`,
			)
			return
		}
		if (options.command === "reset") {
			const ownedAssets = await db
				.select({ key: assets.storageKey })
				.from(assets)
				.where(eq(assets.userId, state.userId))
			for (const asset of ownedAssets) await getStorage().delete(asset.key)
			await removeDemoFeeds(state)
			state.feeds = {}
			await db.delete(user).where(eq(user.id, state.userId))
			state.documents = {}
		}
		// Reserve IDs on disk before any inserts: a crash between the DB commit and a checkpoint resumes.
		for (const item of prepared)
			state.documents[item.capture.url] ??= {
				id: randomUUID(),
				captureHash: item.captureHash,
				complete: false,
				source: feedArticles.has(item.capture.url) ? "feed" : undefined,
			}
		for (const item of preparedFeeds)
			state.feeds[item.capture.url] ??= {
				id: randomUUID(),
				captureHash: item.captureHash,
				complete: false,
			}
		await saveState(options.cache, state)
		const exists = await db.query.user.findFirst({ where: eq(user.id, state.userId) })
		if (!exists) {
			for (const entry of Object.values(state.documents)) entry.complete = false
			await removeDemoFeeds(state)
			for (const entry of Object.values(state.feeds)) entry.complete = false
			await saveState(options.cache, state)
			await createAccount(state)
		}
		const pending = prepared.filter((item) => !state.documents[item.capture.url]!.complete)
		for (const [i, item] of pending.entries()) {
			const versionId = await insertCapture(options.cache, state, item)
			await replayImages(options.cache, item, state.userId, versionId)
			console.log(`[${i + 1}/${pending.length}] replayed ${item.article.title}`)
		}
		// All target documents exist before notes connect them.
		for (const item of pending) {
			await applyHistory(state, item, prepared)
			state.documents[item.capture.url]!.complete = true
			await saveState(options.cache, state)
		}
		for (const item of preparedFeeds) {
			const entry = state.feeds[item.capture.url]!
			if (entry.complete) continue
			await seedFeed(state, item)
			entry.complete = true
			await saveState(options.cache, state)
		}
		const existingSearches = await listSavedSearches(state.userId)
		for (const search of searches)
			if (!existingSearches.some((row) => row.name === search.name))
				await createSavedSearch(state.userId, { name: search.name, query: search.query })
		console.log(JSON.stringify(await verifyDemo(state), null, 2))
		console.log(
			`Sign in: ${state.email}\nPassword: ${PASSWORD}\nBase date: ${state.date}\nOwnership record and corpus: ${options.cache}`,
		)
	} finally {
		if (locked) await lock.query("select pg_advisory_unlock(hashtext('klipstack-demo-reader'))")
		lock.release()
	}
}
