import { canonicalText } from "@klipstack/anchor"
import {
	account,
	assets,
	db,
	documentLinks,
	documentOutlinks,
	documents,
	documentVersions,
	eq,
	highlights,
	pool,
	readingCompletions,
	user,
} from "@klipstack/db"
import { getStorage } from "@klipstack/storage"
import { verifyPassword } from "better-auth/crypto"
import { JSDOM } from "jsdom"
import { extractLinkIds } from "../../app/lib/note-links"
import { listSavedSearches } from "../../app/services/saved-searches.server"
import { searchDocuments } from "../../app/services/search.server"
import { documentTagList } from "../../app/services/tags.server"
import { hash } from "./cache"
import { verifyFeeds } from "./feeds"
import { planHighlights } from "./highlights"
import { PASSWORD, type State } from "./local"
import { articlePlan, searches } from "./profile"

const assertDemo = (ok: unknown, message: string) => {
	if (!ok) throw new Error(`Demo verification: ${message}`)
}

/** Read-only: checks the fixture through stored data, the search service, and actual storage bytes. */
export async function verifyDemo(state: State) {
	const owner = await db.query.user.findFirst({ where: eq(user.id, state.userId) })
	assertDemo(owner?.email === state.email && owner.role === "user", "normal reader account missing")
	const credential = await db.query.account.findFirst({ where: eq(account.userId, state.userId) })
	assertDemo(
		credential?.providerId === "credential" &&
			credential.password &&
			(await verifyPassword({
				hash: credential.password,
				password: PASSWORD,
			})),
		"login credential does not match",
	)
	const docs = await db.select().from(documents).where(eq(documents.userId, state.userId))
	const completions = await db
		.select()
		.from(readingCompletions)
		.where(eq(readingCompletions.userId, state.userId))
	assertDemo(
		docs.length === Object.keys(state.documents).length,
		"document count differs from ownership record",
	)
	const byId = new Map(docs.map((doc) => [doc.id, doc]))
	const storedAssets = await db.select().from(assets).where(eq(assets.userId, state.userId))
	const byAssetId = new Map(storedAssets.map((asset) => [asset.id, asset]))
	for (const asset of storedAssets) {
		const stored = await getStorage().get(asset.storageKey)
		assertDemo(stored, `image file missing: ${asset.id}`)
		const chunks: Buffer[] = []
		for await (const chunk of stored!.body) chunks.push(Buffer.from(chunk))
		assertDemo(hash(Buffer.concat(chunks)) === asset.sha256, `image hash differs: ${asset.id}`)
	}
	const allHighlights = await db
		.select()
		.from(highlights)
		.where(eq(highlights.userId, state.userId))
	const links = await db.select().from(documentLinks).where(eq(documentLinks.userId, state.userId))
	for (const link of links)
		assertDemo(
			byId.has(link.fromDocumentId) && byId.has(link.toDocumentId),
			"note link points outside the account",
		)
	const counts = {
		unread: 0,
		progress: 0,
		finished: 0,
		abandoned: 0,
		trash: 0,
		starred: 0,
		notes: 0,
		highlights: allHighlights.length,
		highlightedArticles: new Set(allHighlights.map((highlight) => highlight.documentId)).size,
		highlightNotes: allHighlights.filter((highlight) => highlight.note).length,
		images: storedAssets.length,
		completions: completions.length,
		noteLinks: links.length,
	}
	const semantic: unknown[] = []
	const normalizeRefs = (value: string) =>
		value
			.replace(
				/\/read\/([a-f0-9-]{36})/g,
				(_match, id: string) => `/read/${byId.get(id)?.sourceUrl ?? "missing"}`,
			)
			.replace(
				/\/assets\/([a-f0-9-]{36})/g,
				(_match, id: string) => `/assets/${byAssetId.get(id)?.sha256 ?? "missing"}`,
			)
	for (const doc of docs.sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl))) {
		const entry = state.documents[doc.sourceUrl]
		assertDemo(
			entry?.id === doc.id && entry.complete,
			`untracked or incomplete article: ${doc.sourceUrl}`,
		)
		assertDemo(
			doc.status === "ready" && doc.currentVersionId,
			`article not ready: ${doc.sourceUrl}`,
		)
		const version = await db.query.documentVersions.findFirst({
			where: eq(documentVersions.id, doc.currentVersionId!),
		})
		assertDemo(
			version?.documentId === doc.id && version.imagesDone,
			`version or images incomplete: ${doc.sourceUrl}`,
		)
		assertDemo(hash(version!.text) === version!.textHash, `text hash differs: ${doc.sourceUrl}`)
		const dom = new JSDOM(`<body>${version!.html}</body>`)
		assertDemo(
			canonicalText(dom.window.document.body) === version!.text,
			`reader text differs: ${doc.sourceUrl}`,
		)
		for (const img of dom.window.document.querySelectorAll("img[src]")) {
			const src = img.getAttribute("src")!
			assertDemo(
				src.startsWith("/assets/") && byAssetId.has(src.slice(8)),
				`image not stored locally: ${doc.sourceUrl}`,
			)
		}
		assertDemo(
			!dom.window.document.querySelector("img[srcset], source[srcset]"),
			"remote responsive image left in reader",
		)
		dom.window.close()
		if (doc.leadImageAssetId) assertDemo(byAssetId.has(doc.leadImageAssetId), "thumbnail missing")
		const plan = articlePlan(
			doc.sourceUrl,
			doc.title ?? "",
			state.seed,
			state.date,
			entry?.source === "feed",
		)
		const history = completions.filter((entry) => entry.documentId === doc.id)
		assertDemo(
			history.length === (plan.dates.readAt ? 1 : 0) &&
				history.every(
					(entry) =>
						entry.cycle === 0 &&
						entry.source === "legacy" &&
						+entry.completedAt === +plan.dates.readAt!,
				),
			`completion history differs: ${doc.sourceUrl}`,
		)
		for (const [key, expected] of Object.entries(plan.dates)) {
			const actual = doc[key as keyof typeof doc]
			// PostgreSQL real has less precision than JavaScript numbers.
			const matches =
				typeof expected === "number"
					? typeof actual === "number" && Math.abs(actual - expected) < 0.00001
					: expected instanceof Date
						? actual instanceof Date && +actual === +expected
						: actual === expected
			assertDemo(matches, `${key} differs from the profile: ${doc.sourceUrl}`)
		}
		counts[plan.state]++
		if (doc.starredAt) counts.starred++
		if (doc.note) counts.notes++
		const articleHighlights = allHighlights.filter((highlight) => highlight.documentId === doc.id)
		for (const highlight of articleHighlights)
			assertDemo(
				highlight.versionId === version!.id &&
					!highlight.orphaned &&
					version!.text.slice(highlight.startOffset, highlight.endOffset) === highlight.exact,
				`invalid highlight anchor: ${doc.sourceUrl}`,
			)
		const plannedHighlights =
			entry?.source === "feed"
				? []
				: planHighlights({
						html: version!.html,
						text: version!.text,
						url: doc.sourceUrl,
						title: doc.title ?? "",
						wordCount: doc.wordCount ?? 0,
						seed: state.seed,
						date: state.date,
					})
		assertDemo(
			articleHighlights.length === plannedHighlights.length &&
				plannedHighlights.every((planned) =>
					articleHighlights.some(
						(actual) =>
							actual.startOffset === planned.start &&
							actual.endOffset === planned.end &&
							actual.exact === planned.exact &&
							actual.color === planned.color &&
							actual.note === planned.note &&
							+actual.createdAt === +planned.createdAt,
					),
				),
			`highlights differ from the profile; use demo:reset: ${doc.sourceUrl}`,
		)

		const tags = await documentTagList(doc.id)
		assertDemo(
			JSON.stringify(tags) === JSON.stringify([...plan.tags].sort()),
			`tags differ: ${doc.sourceUrl}`,
		)
		assertDemo(
			!plan.note || doc.note?.startsWith(plan.note),
			`curated note missing: ${doc.sourceUrl}`,
		)
		const expectedTargets = extractLinkIds(doc.note ?? "")
			.filter((id) => byId.has(id))
			.sort()
		const actualTargets = links
			.filter((link) => link.fromDocumentId === doc.id && !link.highlightId)
			.map((link) => link.toDocumentId)
			.sort()
		assertDemo(
			JSON.stringify(expectedTargets) === JSON.stringify(actualTargets),
			`note links differ: ${doc.sourceUrl}`,
		)
		const indexed = await pool.query(
			"select search @@ plainto_tsquery('simple', unaccent(title)) as found from documents where id = $1",
			[doc.id],
		)
		assertDemo(indexed.rows[0]?.found, `title not searchable: ${doc.sourceUrl}`)
		semantic.push({
			url: doc.sourceUrl,
			title: doc.title,
			dates: plan.dates,
			tags,
			note: normalizeRefs(doc.note ?? ""),
			textHash: version!.textHash,
			html: normalizeRefs(version!.html),
			highlights: articleHighlights
				.map((highlight) => ({
					exact: highlight.exact,
					start: highlight.startOffset,
					end: highlight.endOffset,
					color: highlight.color,
					note: highlight.note,
				}))
				.sort((a, b) => a.start - b.start),
		})
	}
	const saved = await listSavedSearches(state.userId)
	assertDemo(
		searches.every((search) =>
			saved.some((row) => row.name === search.name && row.query === search.query),
		),
		"saved searches missing",
	)
	const searchResults: Record<string, number> = {}
	for (const search of searches)
		searchResults[search.name] = (
			await searchDocuments({ userId: state.userId, q: search.query })
		).items.length
	const outlinks = await db
		.select()
		.from(documentOutlinks)
		.where(eq(documentOutlinks.userId, state.userId))
	const feedState = await verifyFeeds(state)
	return {
		feeds: {
			subscriptions: feedState.subscriptions,
			items: feedState.items,
			dismissed: feedState.dismissed,
		},
		email: state.email,
		articles: docs.length,
		...counts,
		contentLinks: outlinks.filter(
			(link) =>
				docs.some((target) => !target.deletedAt && target.urlHash === link.urlHash) &&
				!byId.get(link.documentId)?.deletedAt,
		).length,
		searchResults,
		fingerprint: hash(JSON.stringify({ articles: semantic, feeds: feedState.semantic })),
	}
}
