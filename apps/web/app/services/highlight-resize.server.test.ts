import { randomUUID } from "node:crypto"
import { selectorFor } from "@klipstack/anchor"
import { db, documentLinks, documents, documentVersions, eq, highlights, user } from "@klipstack/db"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildExport } from "./export.server"
import {
	createHighlight,
	listUserHighlights,
	type ResizeInput,
	resizeHighlight,
	updateHighlight,
} from "./highlights.server"

const userId = `resize-${randomUUID()}`
const text = `Alpha bravo charlie. Alpha bravo charlie.   ${"x".repeat(20_001)}`
let input: ResizeInput
let targetId: string
beforeAll(async () => {
	await db.insert(user).values({ id: userId, name: "Resize", email: `${userId}@example.com` })
	const [target] = await db
		.insert(documents)
		.values({ userId, sourceUrl: "https://example.com/target", urlHash: randomUUID() })
		.returning()
	targetId = target!.id
})
afterAll(async () => {
	await db.delete(user).where(eq(user.id, userId))
})
beforeEach(async () => {
	const [doc] = await db
		.insert(documents)
		.values({ userId, sourceUrl: "https://example.com/resize", urlHash: randomUUID() })
		.returning()
	const [v] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			text,
			html: `<p>${text}</p>`,
			textHash: "test",
			extractor: "test",
			extractorVersion: "1",
		})
		.returning()
	await db
		.update(documents)
		.set({ status: "ready", currentVersionId: v!.id })
		.where(eq(documents.id, doc!.id))
	const created = await createHighlight({
		userId,
		documentId: doc!.id,
		input: {
			exact: "Alpha bravo",
			start: 21,
			end: 32,
			color: 3,
			note: `See [Article](/read/${targetId}).`,
		},
	})
	if (!created.ok) throw new Error("fixture highlight failed")
	input = {
		userId,
		documentId: doc!.id,
		id: created.highlight.id,
		versionId: v!.id,
		previous: { start: 21, end: 32, exact: "Alpha bravo" },
		selector: selectorFor(text, 27, 40),
	}
})

describe("precise highlight resizing", () => {
	it("preserves identity, metadata and note links; recomputes context at exact repeated offsets", async () => {
		const before = await db.query.highlights.findFirst({ where: eq(highlights.id, input.id) })
		const links = await db
			.select()
			.from(documentLinks)
			.where(eq(documentLinks.highlightId, input.id))
		expect(links).toHaveLength(1)
		const result = await resizeHighlight({
			...input,
			selector: { ...input.selector, prefix: "forged", suffix: "forged" },
		})
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.highlight).toMatchObject({
			id: input.id,
			documentId: input.documentId,
			startOffset: 27,
			endOffset: 40,
			exact: text.slice(27, 40),
			prefix: text.slice(0, 27),
			suffix: text.slice(40, 72),
			note: before!.note,
			color: 3,
			createdAt: before!.createdAt,
			versionId: input.versionId,
		})
		expect(
			await db.select().from(documentLinks).where(eq(documentLinks.highlightId, input.id)),
		).toEqual(links)
		expect(await resizeHighlight(input)).toMatchObject({ ok: true, highlight: { id: input.id } })
		const listed = await listUserHighlights({ userId, q: '"bravo charlie"' })
		expect(listed.items.find((h) => h.id === input.id)?.exact).toBe(text.slice(27, 40))
		const exported = await buildExport(userId)
		expect(exported.documents.find((d) => d.id === input.documentId)?.highlights).toEqual([
			expect.objectContaining({
				id: input.id,
				exact: text.slice(27, 40),
				note: before!.note,
				color: 3,
			}),
		])
	})
	it("allows one word and does not clear the note on a color-only service update", async () => {
		await updateHighlight(userId, input.id, { color: 2 })
		const result = await resizeHighlight({ ...input, selector: selectorFor(text, 27, 32) })
		expect(result).toMatchObject({
			ok: true,
			highlight: { exact: "bravo", color: 2, note: expect.any(String) },
		})
	})
	it("checks ownership and both document IDs", async () => {
		for (const patch of [
			{ userId: "someone-else" },
			{ documentId: randomUUID() },
			{ id: randomUUID() },
		])
			expect(await resizeHighlight({ ...input, ...patch })).toEqual({
				ok: false,
				error: "not_found",
			})
		const [other] = await db
			.insert(documents)
			.values({
				userId,
				sourceUrl: "https://example.com/other",
				urlHash: randomUUID(),
				status: "ready",
				currentVersionId: input.versionId,
			})
			.returning()
		expect(await resizeHighlight({ ...input, documentId: other!.id })).toEqual({
			ok: false,
			error: "not_found",
		})
	})
	it.each(["deleted", "orphaned", "document-deleted"])("rejects %s records", async (kind) => {
		if (kind === "document-deleted")
			await db
				.update(documents)
				.set({ deletedAt: new Date() })
				.where(eq(documents.id, input.documentId))
		else
			await db
				.update(highlights)
				.set(kind === "deleted" ? { deletedAt: new Date() } : { orphaned: true })
				.where(eq(highlights.id, input.id))
		expect(await resizeHighlight(input)).toEqual({ ok: false, error: "not_found" })
	})
	it.each([
		[-1, 3],
		[2.5, 5],
		[4, 4],
		[5, 4],
		[0, text.length + 1],
		[0, 20_001],
		[41, 44],
	])("rejects bounds %s..%s", async (start, end) => {
		expect(await resizeHighlight({ ...input, selector: selectorFor(text, start, end) })).toEqual({
			ok: false,
			error: "invalid_range",
		})
	})
	it("does not move a mismatched quote elsewhere", async () => {
		expect(
			await resizeHighlight({ ...input, selector: { ...input.selector, exact: "Alpha bravo" } }),
		).toEqual({ ok: false, error: "no_match" })
	})
	it("rejects old versions, non-ready documents and changed anchors", async () => {
		expect(await resizeHighlight({ ...input, versionId: randomUUID() })).toEqual({
			ok: false,
			error: "version_changed",
		})
		await db
			.update(documents)
			.set({ status: "processing" })
			.where(eq(documents.id, input.documentId))
		expect(await resizeHighlight(input)).toEqual({ ok: false, error: "version_changed" })
		await db.update(documents).set({ status: "ready" }).where(eq(documents.id, input.documentId))
		await db.update(highlights).set({ startOffset: 22 }).where(eq(highlights.id, input.id))
		expect(await resizeHighlight(input)).toEqual({ ok: false, error: "highlight_changed" })
	})
	it("serializes competing resizes so only one original anchor can win", async () => {
		const results = await Promise.all([
			resizeHighlight(input),
			resizeHighlight({ ...input, selector: selectorFor(text, 21, 40) }),
		])
		expect(results.filter((r) => r.ok)).toHaveLength(1)
		expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "highlight_changed" }])
	})
	it.each(["reextract", "delete"])(
		"waits for concurrent %s before validating the write",
		async (kind) => {
			let locked!: () => void
			let release!: () => void
			const acquired = new Promise<void>((resolve) => {
				locked = resolve
			})
			const gate = new Promise<void>((resolve) => {
				release = resolve
			})
			const mutation = db.transaction(async (tx) => {
				if (kind === "reextract") {
					await tx
						.update(documents)
						.set({ status: "processing" })
						.where(eq(documents.id, input.documentId))
				} else {
					await tx
						.update(highlights)
						.set({ deletedAt: new Date() })
						.where(eq(highlights.id, input.id))
				}
				locked()
				await gate
			})
			await acquired
			const resize = resizeHighlight(input)
			release()
			await mutation
			expect(await resize).toEqual({
				ok: false,
				error: kind === "reextract" ? "version_changed" : "not_found",
			})
		},
	)
})
