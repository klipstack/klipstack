import { describe, expect, it } from "vitest"
import { ARCHIVE_FILTERS, INBOX_FILTERS, LIST_FILTERS } from "./enums"
import { COMMON_ERRORS, ERROR_CODES, ERROR_STATUS } from "./errors"
import {
	appendNote,
	createHighlight,
	type Endpoint,
	endpoints,
	getArticle,
	getFeed,
	HTML_MAX_BYTES,
	NUL_REFUSED,
	renameArticle,
	saveArticle,
	setNote,
	updateArticles,
	updateHighlight,
	utf8Length,
} from "./index"
import { Time } from "./schemas"

describe("endpoints", () => {
	it("are keyed by their id", () => {
		for (const [key, endpoint] of Object.entries(endpoints)) expect(endpoint.id).toBe(key)
	})

	it("have unique method and path pairs", () => {
		const seen = new Set<string>()
		for (const e of Object.values(endpoints)) {
			const route = `${e.method} ${e.path}`
			expect(seen.has(route), route).toBe(false)
			seen.add(route)
		}
	})

	it("only list errors that are not common to every endpoint", () => {
		for (const e of Object.values(endpoints))
			for (const code of e.errors) {
				expect(ERROR_CODES, `${e.id}: ${code}`).toContain(code)
				expect(COMMON_ERRORS, `${e.id}: ${code}`).not.toContain(code)
			}
	})

	it("use paths relative to /api/v1 with :name params", () => {
		for (const e of Object.values(endpoints) as Endpoint[]) {
			expect(e.path.startsWith("/")).toBe(true)
			expect(e.path.endsWith("/")).toBe(false)
			const params = [...e.path.matchAll(/:(\w+)/g)].map((m) => m[1])
			expect(Object.keys(e.params?.shape ?? {}).sort()).toEqual(params.sort())
		}
	})
})

describe("enums", () => {
	it("list filters are the inbox and archive filters together", () => {
		expect([...LIST_FILTERS].sort()).toEqual(
			[...new Set([...INBOX_FILTERS, ...ARCHIVE_FILTERS])].sort(),
		)
	})
})

describe("errors", () => {
	it("map every code to a 4xx or 5xx status", () => {
		for (const code of ERROR_CODES) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400)
	})
})

describe("Time", () => {
	it("takes ISO 8601 times Postgres can store", () => {
		for (const ok of [
			"2026-09-01T00:00:00Z",
			"2026-09-01T00:00:00.123Z",
			"2026-09-01T00:00:00+02:00",
			"0001-01-01T00:00:00Z",
			"2024-02-29T23:59:59-15:59",
		])
			expect(Time.safeParse(ok).success, ok).toBe(true)
		for (const bad of [
			"0000-01-01T00:00:00Z",
			"0001-01-01T00:00:00+01:00",
			"2026-09-01T00:00:00+16:00",
			"2026-13-01T00:00:00Z",
			"2026-02-30T00:00:00Z",
			"2026-09-01",
			"yesterday",
		])
			expect(Time.safeParse(bad).success, bad).toBe(false)
	})
})

describe("body sizes", () => {
	it("count UTF-8 bytes", () => {
		for (const text of ["", "abc", "ñ", "€", "😀", "a😀ñ€", "\ud800 lone", "end \ud83d"])
			expect(utf8Length(text), text).toBe(new TextEncoder().encode(text).byteLength)
	})

	it("limit captured pages by bytes, not characters", () => {
		const html = (chars: number, char: string) => ({
			url: "https://x.test",
			html: char.repeat(chars),
		})
		expect(saveArticle.body.safeParse(html(HTML_MAX_BYTES, "a")).success).toBe(true)
		expect(saveArticle.body.safeParse(html(HTML_MAX_BYTES + 1, "a")).success).toBe(false)
		// Fewer characters than the limit, but three bytes each.
		expect(saveArticle.body.safeParse(html(HTML_MAX_BYTES / 2, "€")).success).toBe(false)
		expect(saveArticle.bodyLimit).toBeGreaterThan(HTML_MAX_BYTES)
		// The page as served has the same limit.
		const served = (chars: number, char: string) => ({
			url: "https://x.test",
			servedHtml: char.repeat(chars),
		})
		expect(saveArticle.body.safeParse(served(HTML_MAX_BYTES, "a")).success).toBe(true)
		expect(saveArticle.body.safeParse(served(HTML_MAX_BYTES / 2, "€")).success).toBe(false)
	})
})

describe("ids", () => {
	it("come out lowercase, as the database writes them", () => {
		const upper = "0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B"
		const lower = upper.toLowerCase()
		expect(updateArticles.body.parse({ ids: [upper], starred: true }).ids).toEqual([lower])
		expect(getFeed.query.parse({ feed: upper }).feed).toBe(lower)
		expect(getArticle.params?.parse({ id: upper })).toEqual({ id: lower })
	})
})

describe("stored text", () => {
	it("refuses NUL characters, which Postgres cannot store", () => {
		const nul = `before${String.fromCharCode(0)}after`
		const refused = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
			!result.success && result.error?.issues.some((i) => i.message === NUL_REFUSED)
		expect(refused(setNote.body.safeParse({ note: nul }))).toBe(true)
		expect(refused(appendNote.body.safeParse({ text: nul }))).toBe(true)
		expect(refused(renameArticle.body.safeParse({ title: nul }))).toBe(true)
		expect(refused(createHighlight.body.safeParse({ quote: "q", note: nul }))).toBe(true)
		expect(refused(updateHighlight.body.safeParse({ note: nul }))).toBe(true)
		expect(setNote.body.safeParse({ note: "before after" }).success).toBe(true)
		expect(setNote.body.safeParse({ note: null }).success).toBe(true)
	})
})
