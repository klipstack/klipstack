import { describe, expect, it } from "vitest"
import { articleSummary } from "./article-summary.server"
import type { LibraryCard } from "./documents.server"
import { articleSummary as toolSummary } from "./mcp/results.server"

const ASSET = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"

const card = (status: LibraryCard["status"], failureReason: string | null): LibraryCard => ({
	id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
	title: "T",
	siteName: null,
	author: null,
	sourceUrl: "https://example.com/t",
	description: null,
	readingMinutes: null,
	status,
	failureReason,
	leadImageUrl: null,
	leadImageAssetId: null,
	archivedAt: null,
	starredAt: null,
	shortlistedAt: null,
	readAt: null,
	readingProgress: 0,
	createdAt: new Date("2026-09-01T00:00:00Z"),
	publishedAt: null,
	deletedAt: null,
	firstOpenedAt: null,
	tags: [],
})

describe("articleSummary", () => {
	it("says why a failed article could not be read", () => {
		expect(articleSummary(card("failed", "http_error:404")).failure).toEqual({
			code: "http_error",
			httpStatus: 404,
		})
		expect(articleSummary(card("failed", "no_content")).failure).toEqual({
			code: "no_content",
			httpStatus: null,
		})
		expect(articleSummary(card("failed", null)).failure).toEqual({
			code: "unknown",
			httpStatus: null,
		})
		// A reason left from an attempt that will be retried is not a failure yet.
		expect(articleSummary(card("queued", "timeout")).failure).toBeNull()
		expect(articleSummary(card("ready", null)).failure).toBeNull()
	})

	it("leaves the failure and the picture out of MCP's summaries", () => {
		expect(toolSummary(card("failed", "timeout"))).not.toHaveProperty("failure")
		expect(toolSummary({ ...card("ready", null), leadImageAssetId: ASSET })).not.toHaveProperty(
			"leadImage",
		)
	})

	it("points at the stored picture first, then at the site's own", () => {
		const ready = card("ready", null)
		expect(articleSummary(ready).leadImage).toBeNull()
		expect(
			articleSummary({ ...ready, leadImageUrl: "https://example.com/a.jpg" }).leadImage,
		).toEqual({ url: "https://example.com/a.jpg", downloadUrl: null })
		const stored = articleSummary({
			...ready,
			leadImageUrl: "https://example.com/a.jpg",
			leadImageAssetId: ASSET,
		}).leadImage
		expect(stored?.url).toMatch(new RegExp(`/assets/${ASSET}$`))
		expect(stored?.downloadUrl).toMatch(new RegExp(`/api/v1/assets/${ASSET}$`))
	})
})
