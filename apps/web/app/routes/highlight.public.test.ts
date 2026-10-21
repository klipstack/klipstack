import { createHash } from "node:crypto"
import {
	db,
	documents,
	documentVersions,
	eq,
	highlights,
	highlightShares,
	user as userTable,
} from "@klipstack/db"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { shareHighlight, stopSharingHighlight } from "~/commands/highlight-shares.server"
import { env } from "~/lib/env.server"
import { getShareState } from "~/services/highlight-shares.server"
import { loader as cardLoader } from "./highlight.og"
import { headers, loader, meta } from "./highlight.public"
import { loader as reportLoader } from "./highlight.report"

vi.mock("~/lib/i18n.server", async () => {
	const { createInstance } = await import("i18next")
	const { resources } = await import("@klipstack/i18n")
	const i18n = createInstance()
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
	return { getInstance: () => i18n, getLocale: () => "en" }
})

const userId = `test-shared-page-${Date.now()}`

async function highlight(note: string | null) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://a.example/${Math.random()}`,
			urlHash: `${userId}-${Math.random()}`,
			title: "Maker's Schedule",
			siteName: "Paul Graham",
			status: "ready",
		})
		.returning({ id: documents.id })
	const text = "There are two types of schedule."
	const [v] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: `<p>${text}</p>`,
			text,
			textHash: createHash("sha256").update(`${text}${Math.random()}`).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	const [h] = await db
		.insert(highlights)
		.values({
			userId,
			documentId: doc!.id,
			versionId: v!.id,
			startOffset: 0,
			endOffset: 31,
			exact: text,
			note,
		})
		.returning({ id: highlights.id })
	return h!.id
}

const load = (publicId: string) =>
	loader({
		params: { publicId },
		request: new Request(`http://localhost/h/${publicId}`),
		context: {},
	} as never)

/** The status the loader throws with. */
async function status(run: Promise<unknown>) {
	const thrown: unknown = await run.then(
		() => null,
		(error: unknown) => error,
	)
	if (thrown instanceof Response) return thrown.status
	const init = thrown as { init?: { status?: number }; data?: unknown } | null
	return { status: init?.init?.status, data: init?.data }
}

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "Ada Reader", email: `${userId}@x.test` })
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
})

describe("a shared highlight's page", () => {
	it("shows the snapshot in the sharer's language, never their name, kept out of search", async () => {
		const id = await highlight("Long blocks of time.")
		const { publicId } = await shareHighlight(userId, id, { includeNote: true, locale: "es" })
		const data = await load(publicId)
		expect(data.view).toMatchObject({ exact: "There are two types of schedule.", locale: "es" })
		expect(data.view.note).toEqual([[{ text: "Long blocks of time.", href: null }]])
		expect(data.labels.readArticle).toBe("Leer el artículo")
		expect(data.title).toBe("Un subrayado de «Maker's Schedule»")
		expect(data.url).toBe(`${env.APP_URL}/h/${publicId}`)
		expect(data.image).toMatch(new RegExp(`/h/${publicId}/og\\.png\\?v=`))
		expect(JSON.stringify(data)).not.toContain("Ada Reader")
		expect(headers()).toMatchObject({ "X-Robots-Tag": "noindex" })
		expect(meta({ loaderData: data } as never)).toEqual(
			expect.arrayContaining([
				{ name: "robots", content: "noindex" },
				{ property: "og:image", content: data.image },
			]),
		)
		const card = (await cardLoader({ params: { publicId } } as never)) as Response
		expect(card.headers.get("Content-Type")).toBe("image/png")
		expect((await card.arrayBuffer()).byteLength).toBeGreaterThan(1000)
	})

	it("is gone once stopped, and says so apart when taken down; an unknown one never was", async () => {
		const id = await highlight(null)
		const { publicId } = await shareHighlight(userId, id, { includeNote: true, locale: "en" })
		await stopSharingHighlight(userId, id)
		expect(await status(load(publicId))).toEqual({ status: 410, data: null })
		expect(await status(cardLoader({ params: { publicId } } as never))).toMatchObject({
			status: 410,
		})
		expect(
			await status(reportLoader({ params: { publicId }, context: {} } as never)),
		).toMatchObject({ status: 410 })

		const again = await shareHighlight(userId, id, { includeNote: true, locale: "en" })
		await db
			.update(highlightShares)
			.set({ removedAt: new Date(), removedGround: "spam", removedNote: "Spam." })
			.where(eq(highlightShares.highlightId, id))
		expect(await status(load(again.publicId))).toEqual({ status: 410, data: { removed: true } })

		expect(await status(load("AAAAAAAAAAAA"))).toMatchObject({ status: 404 })
		expect(await status(load("../etc"))).toMatchObject({ status: 404 })
	})

	it("draws a new picture after an update, so link previews do not keep the old one", async () => {
		const id = await highlight("Before.")
		const { publicId } = await shareHighlight(userId, id, { includeNote: true, locale: "en" })
		const picture = async () => {
			const data = await load(publicId)
			const card = (await cardLoader({ params: { publicId } } as never)) as Response
			return { url: data.image, png: Buffer.from(await card.arrayBuffer()) }
		}
		const before = await picture()
		expect(await sharp(before.png).metadata()).toMatchObject({ width: 1200, height: 630 })
		await db.update(highlights).set({ note: "After, and longer." }).where(eq(highlights.id, id))
		await shareHighlight(userId, id, { includeNote: true, locale: "en" })
		const after = await picture()
		expect(after.url).not.toBe(before.url)
		expect(after.png.equals(before.png)).toBe(false)
	})

	describe("shows at most 100 words or 600 characters of the quote and the note", () => {
		const words = (from: number, to: number) =>
			Array.from({ length: to - from }, (_, i) => `w${from + i + 1}`).join(" ")

		/** The public page's quote and note for a highlight with this text and note. */
		async function shown(exact: string, note: string | null = null) {
			const id = await highlight(note)
			await db.update(highlights).set({ exact }).where(eq(highlights.id, id))
			const { publicId } = await shareHighlight(userId, id, { includeNote: true, locale: "en" })
			const data = await load(publicId)
			return { id, data, note: data.view.note?.map((l) => l.map((r) => r.text).join("")) }
		}

		it("cuts after word 100, keeping paragraph breaks, and keeps the whole quote for its owner", async () => {
			const { id, data } = await shown(`${words(0, 10)}\n\n${words(10, 130)}`)
			expect(data.view.exact).toBe(`${words(0, 10)}\n\n${words(10, 100)}…`)
			expect(JSON.stringify(data)).not.toContain("w101")
			expect(await getShareState(userId, id)).toMatchObject({ changed: false })
			// Exactly 100 words is shown whole, with no ellipsis.
			expect((await shown(words(0, 100))).data.view.exact).toBe(words(0, 100))
		})

		it("cuts long words at the last word that ends within 600 characters", async () => {
			// 59 words of 10 characters, a space apart: the 55th ends at 604, the 54th at 593.
			const long = Array.from({ length: 59 }, (_, i) => `word${String(i).padStart(6, "0")}`)
			expect((await shown(long.join(" "))).data.view.exact).toBe(`${long.slice(0, 54).join(" ")}…`)
		})

		it("cuts text without spaces at 600 characters", async () => {
			const exact = "あ".repeat(700)
			expect((await shown(exact)).data.view.exact).toBe(`${"あ".repeat(600)}…`)
		})

		it("cuts the note by what it shows, never inside a link", async () => {
			const link = (title: string) => `[${title}](/read/00000000-0000-4000-8000-000000000000)`
			// The link's title holds words 96 to 105: the cut falls inside it, so it goes whole.
			const note = `${words(0, 95)} ${link(words(95, 105))} ${words(105, 110)}`
			expect((await shown("Short.", note)).note).toEqual([`${words(0, 95)} …`])
			// A link to a saved article that ends before the cut stays a link to its original.
			const [target] = await db
				.select({ documentId: highlights.documentId, url: documents.sourceUrl })
				.from(highlights)
				.innerJoin(documents, eq(documents.id, highlights.documentId))
				.where(eq(highlights.id, await highlight(null)))
			const real = `[Linked](/read/${target!.documentId})`
			const kept = await shown("Short.", `${real} ${words(1, 120)}`)
			expect(kept.data.view.note?.[0]?.[0]).toEqual({ text: "Linked", href: target!.url })
			expect(kept.note).toEqual([`Linked ${words(1, 100)}…`])
		})

		it("counts a note's line breaks, cutting in its second paragraph", async () => {
			// 590 characters on the first line, its break, then 9 more fit; the next word does not.
			const first = "x".repeat(590)
			const { note } = await shown("Short.", `${first}\nabcdefgh ijklmnop`)
			expect(note).toEqual([first, "abcdefgh…"])
		})
	})

	it("points a quote the font cannot draw at the Klipstack card", async () => {
		const id = await highlight(null)
		await db.update(highlights).set({ exact: "日本語の引用です。" }).where(eq(highlights.id, id))
		const { publicId } = await shareHighlight(userId, id, { includeNote: true, locale: "en" })
		const data = await load(publicId)
		expect(data.image).not.toContain("/og.png")
		expect(await status(cardLoader({ params: { publicId } } as never))).toBe(302)
	})
})
