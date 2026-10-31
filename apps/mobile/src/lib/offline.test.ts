import type { ArticleDetails, ArticleSummary } from "@klipstack/sdk"
import { KlipstackApiError } from "@klipstack/sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** expo-file-system's classes over a map of paths to contents and write times. */
const disk = vi.hoisted(() => ({
	files: new Map<string, { content: string | Uint8Array; at: number }>(),
	clock: 0,
}))
vi.mock("expo-file-system", () => {
	const join = (...parts: (string | { uri: string })[]) =>
		parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/")
	const under = (uri: string) => [...disk.files.keys()].filter((p) => p.startsWith(`${uri}/`))
	class Directory {
		uri: string
		constructor(...parts: (string | { uri: string })[]) {
			this.uri = join(...parts)
		}
		get name() {
			return this.uri.split("/").pop()!
		}
		get exists() {
			return under(this.uri).length > 0
		}
		get size() {
			return under(this.uri).reduce((sum, p) => sum + disk.files.get(p)!.content.length, 0)
		}
		create() {}
		delete() {
			for (const path of under(this.uri)) disk.files.delete(path)
		}
		list() {
			const entries = new Map<string, Directory | File>()
			for (const path of under(this.uri)) {
				const [name, ...rest] = path.slice(this.uri.length + 1).split("/")
				entries.set(name!, rest.length ? new Directory(this, name!) : new File(this, name!))
			}
			return [...entries.values()]
		}
	}
	class File {
		uri: string
		constructor(...parts: (string | { uri: string })[]) {
			this.uri = join(...parts)
		}
		get name() {
			return this.uri.split("/").pop()!
		}
		get exists() {
			return disk.files.has(this.uri)
		}
		get modificationTime() {
			return disk.files.get(this.uri)?.at ?? null
		}
		create() {
			disk.files.set(this.uri, { content: "", at: ++disk.clock })
		}
		writeSync(content: string | Uint8Array) {
			disk.files.set(this.uri, { content, at: ++disk.clock })
		}
		textSync() {
			const file = disk.files.get(this.uri)
			if (!file) throw new Error("missing file")
			return String(file.content)
		}
	}
	return { Directory, File, Paths: { cache: "cache", document: "documents" } }
})

const offline = await import("./offline")
const { downloadAhead, downloading, forgetOffline } = await import("./offline-download")

const summary = (id: string, status: ArticleSummary["status"] = "ready") =>
	({ id, status }) as ArticleSummary
const details = (id: string) => ({ id, status: "ready", title: id }) as unknown as ArticleDetails
const page = (images: string[] = []) => ({
	versionId: "v1",
	html: images.map((id) => `<img src="/assets/${id}">`).join(""),
})
const assetId = (n: number) => `00000000-0000-0000-0000-00000000000${n}`

function fakeClient(html: Record<string, ReturnType<typeof page>> = {}) {
	return {
		articles: {
			get: vi.fn(async (id: string) => details(id)),
			html: vi.fn(async (id: string) => html[id] ?? page()),
		},
		assets: {
			download: vi.fn(
				async () =>
					new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
			),
		},
	}
}
type Client = Parameters<typeof downloadAhead>[0]

beforeEach(() => {
	forgetOffline()
	disk.files.clear()
})

describe("offline lists and articles", () => {
	it("keeps a list and an article, and reads nothing for what it never kept", () => {
		expect(offline.loadList("inbox")).toBeNull()
		expect(offline.loadArticle("a")).toBeNull()
		offline.saveList("inbox", [summary("a")])
		offline.saveArticle(details("a"), page(), 42)
		expect(offline.loadList("inbox")).toEqual([summary("a")])
		expect(offline.loadArticle("a")).toEqual({ details: details("a"), stored: page(), savedAt: 42 })
	})

	it("keeps the starter texts last shown, until sign-out", () => {
		expect(offline.keptStarter("starter-es")).toBeNull()
		offline.keepStarter("starter-es", { language: "es", shelves: [] })
		offline.keepStarter("starter-offer", { guide: null, texts: [] })
		expect(offline.keptStarter("starter-es")).toEqual({ language: "es", shelves: [] })
		expect(offline.keptStarter("starter-en")).toBeNull()
		offline.forgetLists()
		expect(offline.keptStarter("starter-es")).toBeNull()
		expect(offline.keptStarter("starter-offer")).toBeNull()
	})

	it("answers from the phone only when the server didn't say no", () => {
		expect(offline.canUseOffline(new TypeError("Network request failed"))).toBe(true)
		expect(offline.canUseOffline(new KlipstackApiError(503, "unavailable", "down"))).toBe(true)
		expect(offline.canUseOffline(new KlipstackApiError(404, "not_found", "gone"))).toBe(false)
		expect(offline.canUseOffline(new KlipstackApiError(401, "unauthorized", "no"))).toBe(false)
		expect(offline.lostConnection(new TypeError("Network request failed"))).toBe(true)
		expect(offline.lostConnection(new Error("fetch failed: Could not connect"))).toBe(true)
		expect(offline.lostConnection(new KlipstackApiError(503, "unavailable", "down"))).toBe(false)
	})

	it("prunes the oldest articles no list shows first, then the end of the lists", () => {
		for (const id of ["old", "kept-1", "newer", "kept-2"]) offline.saveArticle(details(id), page())
		expect(offline.pruneArticles(["kept-1", "kept-2"], { maxArticles: 3 })).toEqual(["old"])
		expect(offline.pruneArticles(["kept-1", "kept-2"], { maxArticles: 1 })).toEqual([
			"kept-2",
			"newer",
		])
		expect(offline.loadArticle("kept-1")).not.toBeNull()
	})

	it("prunes by space too", () => {
		offline.saveArticle(details("a"), page())
		offline.saveArticle(details("b"), page())
		const one = disk.files.get("cache/reader/a/article.json")!.content.length
		expect(offline.pruneArticles(["a", "b"], { maxBytes: one + 1 })).toEqual(["b"])
	})
})

describe("downloading ahead", () => {
	it("keeps each ready article with its images, once an hour", async () => {
		const client = fakeClient({ a: page([assetId(1), assetId(2)]) })
		await downloadAhead(client as unknown as Client, "home", [
			summary("a"),
			summary("b", "processing"),
		])
		expect(client.articles.get).toHaveBeenCalledTimes(1)
		expect(offline.loadArticle("a")?.stored.html).toContain(assetId(1))
		expect(offline.loadArticle("b")).toBeNull()
		expect(client.assets.download).toHaveBeenCalledTimes(2)
		expect([...disk.files.keys()]).toContain(`cache/reader/a/${assetId(2)}.png`)

		await downloadAhead(client as unknown as Client, "inbox", [summary("a")])
		expect(client.articles.get).toHaveBeenCalledTimes(1)
		expect(client.assets.download).toHaveBeenCalledTimes(2)
	})

	it("stops at a lost connection, and goes on past an article that's gone", async () => {
		const client = fakeClient()
		client.articles.get
			.mockRejectedValueOnce(new KlipstackApiError(404, "not_found", "gone"))
			.mockRejectedValueOnce(new TypeError("Network request failed"))
		await downloadAhead(client as unknown as Client, "home", [
			summary("gone"),
			summary("cut"),
			summary("never"),
		])
		expect(client.articles.get).toHaveBeenCalledTimes(2)
		expect(offline.loadArticle("never")).toBeNull()
	})

	it("writes nothing after sign-out", async () => {
		const client = fakeClient()
		let answer = () => {}
		client.articles.get.mockImplementationOnce(
			(id: string) =>
				new Promise((resolve) => {
					answer = () => resolve(details(id))
				}),
		)
		void downloadAhead(client as unknown as Client, "home", [summary("a")])
		const pass = downloading()
		forgetOffline()
		answer()
		await pass
		expect(offline.loadArticle("a")).toBeNull()
		expect(disk.files.size).toBe(0)
	})
})
