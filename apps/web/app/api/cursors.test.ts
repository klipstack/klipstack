import { describe, expect, it } from "vitest"
import { isCursorTime } from "~/lib/page-cursor"
import { encodeCursor } from "~/services/documents.server"
import {
	articleCursor,
	encodeFeedCursor,
	encodeHighlightCursor,
	feedCursor,
	highlightCursor,
} from "./cursors.server"

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"

describe("cursors", () => {
	it("accept only times Postgres can read", () => {
		expect(isCursorTime("2026-09-01T10:00:00.123456Z")).toBe(true)
		expect(isCursorTime("2024-02-29T23:59:59Z")).toBe(true)
		for (const bad of [
			"2026-13-01T00:00:00Z",
			"2026-02-30T00:00:00Z",
			"2026-09-01T24:00:00Z",
			"0000-01-01T00:00:00Z",
			"2026-09-01T00:00:00+02:00",
			"soon",
		])
			expect(isCursorTime(bad), bad).toBe(false)
	})

	it("round-trip, and refuse anything else with 400", () => {
		const article = { k: 12, t: "2026-09-01T10:00:00.123456Z", id: ID }
		expect(articleCursor(encodeCursor(article))).toEqual(article)
		for (const k of [null, 2 ** 31 - 1, -1])
			expect(articleCursor(encodeCursor({ ...article, k }))).toMatchObject({ k })
		expect(articleCursor(undefined)).toBeNull()
		for (const bad of [
			"nope",
			encodeCursor({ ...article, t: "2026-13-01T00:00:00Z" }),
			encodeCursor({ ...article, id: "x" }),
			encodeCursor({ ...article, k: 1.5 }),
			encodeCursor({ ...article, k: 2 ** 31 }),
			encodeCursor({ ...article, k: -(2 ** 31) - 1 }),
		])
			expect(() => articleCursor(bad)).toThrow(expect.objectContaining({ status: 400 }))
		const highlight = { createdAt: "2026-09-01T10:00:00.1Z", id: ID }
		expect(highlightCursor(encodeHighlightCursor(highlight))).toEqual(highlight)
		expect(() =>
			highlightCursor(encodeHighlightCursor({ ...highlight, createdAt: "2026-00-10T00:00:00Z" })),
		).toThrow(expect.objectContaining({ code: "invalid_request" }))
		const feed = { feed: ID, sortKey: "2026-09-01T10:00:00.123456Z", id: ID }
		expect(feedCursor(encodeFeedCursor(feed))).toEqual(feed)
		expect(feedCursor(encodeFeedCursor({ ...feed, feed: ID.toUpperCase() }))).toEqual(feed)
		for (const bad of [
			{ ...feed, feed: "x" },
			{ ...feed, sortKey: "soon" },
			{ ...feed, id: 1 },
		])
			expect(() => feedCursor(encodeFeedCursor(bad as typeof feed))).toThrow(
				expect.objectContaining({ code: "invalid_request" }),
			)
	})
})
