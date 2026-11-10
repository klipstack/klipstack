import { randomUUID } from "node:crypto"
import { gzipSync } from "node:zlib"
import { FAKE_FAIL } from "@klipstack/ai"
import {
	accountBilling,
	addUsage,
	and,
	db,
	documentRaw,
	documents,
	documentVersions,
	eq,
	monthOf,
	pool,
	sql,
	showVersion,
	usageCounts,
	user,
	userFeatures,
} from "@klipstack/db"
import { articleBody } from "@klipstack/extract"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})
vi.mock("@klipstack/db", async (original) => ({
	...(await original<typeof import("@klipstack/db")>()),
	notifyDocumentEvent: async () => undefined,
}))

const { handleExtract } = await import("./extract")
const { handleTranslate, sameMarkup, settleStuckTranslations, splitParts } =
	await import("./translate")

const userId = `translate-${randomUUID()}`
const { month } = monthOf()
const page = (title: string, words: string) =>
	`<!doctype html><html lang="en"><head><title>${title}</title></head><body><article><h1>${title}</h1>${`<p>${words} <a href="https://example.com/source">a source</a>, and <strong>bold words</strong>.</p>`.repeat(12)}</article></body></html>`

beforeAll(async () => {
	await db.insert(user).values({ id: userId, name: "Translate", email: `${userId}@example.com` })
})
afterAll(async () => {
	await db.execute(
		sql`delete from pgboss.job where data->>'versionId' in (select v.id::text from document_versions v join documents d on d.id = v.document_id where d.user_id = ${userId})`,
	)
	await db.delete(user).where(eq(user.id, userId))
	await stopBoss()
	await pool.end()
})

const capture = (documentId: string, title: string, words: string) =>
	db.insert(documentRaw).values({
		documentId,
		rawHtml: gzipSync(Buffer.from(page(title, words), "utf8")),
		finalUrl: "https://example.com/article",
		httpStatus: 200,
		contentType: "text/html",
		source: "extension",
		fetchedAt: new Date(),
	})

const extractJob = (documentId: string) =>
	({ data: { documentId }, retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleExtract>[0]

/** An extracted article, waiting for its translation into Spanish (2 credits taken). */
async function waiting(title = "Two questions") {
	const [doc] = await db
		.insert(documents)
		.values({ userId, sourceUrl: `https://example.com/${randomUUID()}`, urlHash: randomUUID() })
		.returning()
	await capture(doc!.id, title, "Makers need long blocks of time to do their work well")
	await handleExtract(extractJob(doc!.id))
	const ready = await read(doc!.id)
	await db.update(documents).set({ translationStatus: "pending" }).where(eq(documents.id, doc!.id))
	await addUsage(db, userId, "translations", 2, month)
	const job = (retryCount = 0) =>
		({
			data: {
				documentId: doc!.id,
				sourceVersionId: ready!.currentVersionId!,
				language: "es",
				credits: 2,
				month,
			},
			retryCount,
			retryLimit: 2,
		}) as Parameters<typeof handleTranslate>[0]
	return { id: doc!.id, original: ready!.currentVersionId!, job }
}

const read = (id: string) => db.query.documents.findFirst({ where: eq(documents.id, id) })
const current = async (id: string) =>
	db.query.documentVersions.findFirst({
		where: eq(documentVersions.id, (await read(id))!.currentVersionId!),
	})
async function credits() {
	const [row] = await db
		.select({ count: usageCounts.count })
		.from(usageCounts)
		.where(
			and(
				eq(usageCounts.userId, userId),
				eq(usageCounts.metric, "translations"),
				eq(usageCounts.month, month),
			),
		)
	return row?.count ?? 0
}
const found = async (id: string, query: string) => {
	const { rows } = await db.execute<{ id: string }>(
		sql`select id from documents where id = ${id} and search @@ websearch_to_tsquery('simple', ${query})`,
	)
	return rows.length === 1
}

describe("handleTranslate", () => {
	it("shows the translation, with its title, language and markup, and keeps the original", async () => {
		const doc = await waiting()
		await handleTranslate(doc.job())
		const after = await read(doc.id)
		expect(after).toMatchObject({
			language: "es",
			originalVersionId: doc.original,
			translationStatus: null,
		})
		expect(after!.title).toMatch(/^este es/)
		const translation = await current(doc.id)
		expect(translation).toMatchObject({ translatedFromId: doc.original, extractor: "translation" })
		expect(translation!.html).toContain('<a href="https://example.com/source"')
		expect(translation!.html).toContain("<strong>")
		expect(translation!.text).toContain("traducido")
		// Found by the translation's words and the original's.
		expect(await found(doc.id, "traducido")).toBe(true)
		expect(await found(doc.id, "makers")).toBe(true)
	})

	it("keeps the original's stored images", async () => {
		const doc = await waiting()
		// As the images job leaves the original: a stored copy, and one it couldn't store.
		const stored = `<img src="/assets/${randomUUID()}" data-original-src="https://example.com/a.png" alt="A chart">`
		const original = await db.query.documentVersions.findFirst({
			where: eq(documentVersions.id, doc.original),
		})
		await db
			.update(documentVersions)
			.set({
				html: `${stored}${original!.html}<img src="https://example.com/b.png">`,
				imagesDone: true,
			})
			.where(eq(documentVersions.id, doc.original))
		await handleTranslate(doc.job())
		expect(await read(doc.id)).toMatchObject({ language: "es", translationStatus: null })
		const translation = await current(doc.id)
		expect(translation!.html).toContain(stored)
		expect(translation!.html).toContain('<img src="https://example.com/b.png">')
	})

	it("gives the credits back and leaves the original shown when the last try fails", async () => {
		const doc = await waiting(`Broken ${FAKE_FAIL}`)
		const before = await credits()
		// A try with retries left fails, to be retried.
		await expect(handleTranslate(doc.job(0))).rejects.toThrow()
		expect((await read(doc.id))?.translationStatus).toBe("pending")
		await handleTranslate(doc.job(2))
		expect(await read(doc.id)).toMatchObject({
			translationStatus: "failed",
			currentVersionId: doc.original,
			originalVersionId: null,
			language: "en",
		})
		expect(await credits()).toBe(before - 2)
	})

	it("shows nothing, and gives the credits back, when a new capture landed meanwhile", async () => {
		const doc = await waiting()
		await capture(doc.id, "Two questions, revised", "Managers work in one hour slots all day long")
		await handleExtract(extractJob(doc.id))
		const before = await credits()
		await handleTranslate(doc.job())
		const after = await read(doc.id)
		expect(after!.currentVersionId).not.toBe(doc.original)
		// Nothing failed: the reader offers to translate the new version, not to retry.
		expect(after).toMatchObject({ originalVersionId: null, translationStatus: null })
		expect(await credits()).toBe(before - 2)
	})

	it("forgets a failed translation once a new capture is read", async () => {
		const doc = await waiting(`Broken ${FAKE_FAIL}`)
		await handleTranslate(doc.job(2))
		expect((await read(doc.id))?.translationStatus).toBe("failed")
		await capture(doc.id, "Two questions, revised", "Managers work in one hour slots all day long")
		await handleExtract(extractJob(doc.id))
		expect((await read(doc.id))?.translationStatus).toBeNull()
	})
})

describe("Always translate, as an article is saved", () => {
	const readers: string[] = []
	afterAll(async () => {
		for (const id of readers) {
			await db.execute(
				sql`delete from pgboss.job where data->>'documentId' in (select id::text from documents where user_id = ${id})`,
			)
			await db.delete(user).where(eq(user.id, id))
		}
	})

	/** A reader of the app in Spanish who always translates English, with AI. */
	async function reader(prefs: Record<string, unknown> = { alwaysTranslate: ["en"] }, ai = true) {
		const id = `always-${randomUUID()}`
		await db
			.insert(user)
			.values({ id, name: "Lectora", email: `${id}@example.com`, locale: "es", prefs })
		if (ai) await db.insert(userFeatures).values({ userId: id, feature: "ai" })
		readers.push(id)
		return id
	}

	/** An English article of about 132 words, saved by `owner` and extracted. */
	async function saved(owner: string, captureSource: "extension" | "feed" = "extension") {
		const [doc] = await db
			.insert(documents)
			.values({
				userId: owner,
				sourceUrl: `https://example.com/${randomUUID()}`,
				urlHash: randomUUID(),
				captureSource,
			})
			.returning()
		await capture(doc!.id, "Two questions", "Makers need long blocks of time to do their work well")
		await handleExtract(extractJob(doc!.id))
		return doc!.id
	}

	const queuedFor = async (id: string) =>
		(
			await db.execute<{ data: { language: string; credits: number } }>(
				sql`select data from pgboss.job where name = 'translate' and data->>'documentId' = ${id}`,
			)
		).rows.map((r) => r.data)

	const used = async (owner: string) => {
		const [row] = await db
			.select({ count: usageCounts.count })
			.from(usageCounts)
			.where(
				and(
					eq(usageCounts.userId, owner),
					eq(usageCounts.metric, "translations"),
					eq(usageCounts.month, month),
				),
			)
		return row?.count ?? 0
	}

	it("queues the translation into the reader's language, for its credits", async () => {
		const owner = await reader()
		const id = await saved(owner)
		expect((await read(id))?.translationStatus).toBe("pending")
		expect(await queuedFor(id)).toMatchObject([{ language: "es", credits: 1 }])
		expect(await used(owner)).toBe(1)
	})

	it("takes the last credit, and no more when two articles share it", async () => {
		const owner = await reader()
		await addUsage(db, owner, "translations", 29, month)
		const first = await saved(owner)
		const second = await saved(owner)
		expect(await queuedFor(first)).toHaveLength(1)
		expect(await queuedFor(second)).toEqual([])
		expect(await used(owner)).toBe(30)
	})

	it("leaves an account that can't add to its library offered", async () => {
		const owner = await reader()
		// An admin's date in the past, with billing on: lapsed.
		await db
			.insert(accountBilling)
			.values({ userId: owner, freeUntil: new Date(Date.now() - 86_400_000) })
		process.env.BILLING_STARTS_AT = new Date(Date.now() - 90 * 86_400_000).toISOString()
		try {
			const id = await saved(owner)
			expect(await queuedFor(id)).toEqual([])
			expect(await used(owner)).toBe(0)
		} finally {
			delete process.env.BILLING_STARTS_AT
		}
	})

	it("leaves a feed item, another language, an account without AI or out of credits offered", async () => {
		const always = await reader()
		const other = await reader({ alwaysTranslate: ["fr"] })
		const noAi = await reader({ alwaysTranslate: ["en"] }, false)
		const turnedOff = await reader({ alwaysTranslate: ["en"], ai: "off" })
		const spent = await reader()
		await addUsage(db, spent, "translations", 30, month)
		const ids = [
			await saved(always, "feed"),
			await saved(other),
			await saved(noAi),
			await saved(turnedOff),
			await saved(spent),
		]
		for (const id of ids) {
			expect((await read(id))?.translationStatus).toBeNull()
			expect(await queuedFor(id)).toEqual([])
		}
		// Nothing taken past the cap.
		expect(await used(spent)).toBe(30)
		expect(await used(always)).toBe(0)
	})

	it("doesn't translate again an article that was, once its original is put back", async () => {
		const owner = await reader()
		const id = await saved(owner)
		const [job] = await queuedFor(id)
		await handleTranslate({
			data: { ...(job as object), documentId: id },
			retryCount: 0,
			retryLimit: 2,
		} as Parameters<typeof handleTranslate>[0])
		const translated = await read(id)
		expect(translated?.originalVersionId).not.toBeNull()
		// "Use original", then a new capture of it.
		await db.transaction((tx) => showVersion(tx, id, translated!.originalVersionId!, null))
		await capture(id, "Two questions", "Makers need long blocks of time to do their work well")
		await handleExtract(extractJob(id))
		expect((await read(id))?.originalVersionId).toBeNull()
		expect(await queuedFor(id)).toHaveLength(1)
		expect(await used(owner)).toBe(1)
	})
})

describe("settleStuckTranslations", () => {
	/** The job as pg-boss leaves it: `state`, without the handler having run. */
	async function queued(data: Record<string, unknown>, state: "failed" | "active") {
		await db.execute(
			sql`insert into pgboss.job (name, data, state) values ('translate', ${JSON.stringify(data)}::jsonb, ${state})`,
		)
	}

	it("fails a translation whose job pg-boss gave up on, and gives its credits back", async () => {
		const doc = await waiting()
		const running = await waiting()
		await queued(doc.job().data, "failed")
		await queued(running.job().data, "active")
		const before = await credits()
		const settled = await settleStuckTranslations([userId])
		expect(settled).toContain(doc.id)
		expect(settled).not.toContain(running.id)
		expect((await read(doc.id))?.translationStatus).toBe("failed")
		expect(await credits()).toBe(before - 2)
		// One still running is left to its job.
		expect((await read(running.id))?.translationStatus).toBe("pending")
		await db.execute(sql`delete from pgboss.job where data->>'documentId' = ${running.id}`)
		await settleStuckTranslations([userId])
	})
})

describe("extracting a translated article again", () => {
	it("keeps the translation shown, and makes the new capture its original", async () => {
		const doc = await waiting()
		await handleTranslate(doc.job())
		const translated = await read(doc.id)
		await capture(doc.id, "Two questions, revised", "Managers work in one hour slots all day long")
		await handleExtract(extractJob(doc.id))
		const after = await read(doc.id)
		expect(after).toMatchObject({
			currentVersionId: translated!.currentVersionId,
			title: translated!.title,
			language: "es",
		})
		expect(after!.originalVersionId).not.toBe(doc.original)
		const original = await db.query.documentVersions.findFirst({
			where: eq(documentVersions.id, after!.originalVersionId!),
		})
		expect(original).toMatchObject({ title: "Two questions, revised", language: "en" })
		expect(await found(doc.id, "managers")).toBe(true)
		expect(await found(doc.id, "makers")).toBe(false)
	})
})

describe("splitParts", () => {
	const p = (words: number) => `<p>${"word ".repeat(words).trim()}</p>`

	it("cuts between blocks, about so many words a part, and keeps every block", () => {
		const html = [p(40), p(40), p(40), p(40)].join("")
		const parts = splitParts(html, 100)
		expect(parts).toEqual([p(40) + p(40), p(40) + p(40)])
	})

	it("opens up a container too long for one part, and keeps a short one whole", () => {
		expect(splitParts(`<div>${p(40)}${p(40)}</div>`, 100)).toEqual([`<div>${p(40)}${p(40)}</div>`])
		expect(splitParts(`<div>${p(80)}${p(80)}</div>`, 100)).toEqual([p(80), p(80)])
	})
})

describe("sameMarkup", () => {
	const original =
		'<p>See <a id="cite-1">note 1</a>, <abbr id="mw1">XIII<sup>e</sup></abbr> and <img src="https://example.com/cat.png" alt="Un gato">.</p>'

	it("is true for a translation that only translates, and drops plain formatting", () => {
		expect(
			sameMarkup(
				'<p>See <a id="cite-1">note 1</a>, <abbr id="mw1">13th</abbr> and <img src="https://example.com/cat.png" alt="A cat">.</p>',
				original,
			),
		).toBe(true)
	})

	it("tells a link or image source added after a quoted >, as the browser parses it", () => {
		expect(
			sameMarkup(
				'<p>See <a id="cite-1" title=">" href="https://attacker.example/phish">note 1</a>, <abbr id="mw1">13th</abbr> and <img src="https://example.com/cat.png" alt=">" srcset="https://attacker.example/pixel.png 1x">.</p>',
				original,
			),
		).toBe(false)
	})

	it("holds stored images, which the worker's sanitizing keeps, to the original's", () => {
		const [a, b] = [randomUUID(), randomUUID()]
		const sent = `<p>Hello there friend.</p><img src="/assets/${a}" alt="A chart">`
		const back = (html: string) => sameMarkup(articleBody(html, { storedImages: true }).html, sent)
		expect(back(`<p>Hola, amigo.</p><img src="/assets/${a}" alt="Un gráfico">`)).toBe(true)
		expect(back(`<p>Hola, amigo.</p><img src="/assets/${b}" alt="Un gráfico">`)).toBe(false)
		expect(
			back(`<p>Hola, <img src="/assets/${b}"> amigo.</p><img src="/assets/${a}" alt="Un gráfico">`),
		).toBe(false)
	})

	it("keeps each value in its own attribute: a newline in one can't pass for another element", () => {
		expect(
			sameMarkup(
				'<p lang="en x">Lea más.</p><a href="https://attacker.example/phish">Verifique su cuenta</a>',
				'<p lang="en x&#10;a href=https://attacker.example/phish">Read more.</p>',
			),
		).toBe(false)
	})
})
