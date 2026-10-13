import { beforeEach, describe, expect, it, vi } from "vitest"

/** expo-file-system's classes over a map of paths to contents: enough for what reader-files does. */
const disk = vi.hoisted(() => new Map<string, string | Uint8Array>())
vi.mock("expo-file-system", () => {
	const join = (...parts: (string | { uri: string })[]) =>
		parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/")
	class Directory {
		uri: string
		constructor(...parts: (string | { uri: string })[]) {
			this.uri = join(...parts)
		}
		get exists() {
			return [...disk.keys()].some((path) => path.startsWith(`${this.uri}/`))
		}
		create() {}
		delete() {
			for (const path of disk.keys()) if (path.startsWith(`${this.uri}/`)) disk.delete(path)
		}
		list() {
			const names = new Set<string>()
			for (const path of disk.keys())
				if (path.startsWith(`${this.uri}/`))
					names.add(path.slice(this.uri.length + 1).split("/")[0]!)
			return [...names].map((name) => new File(this, name))
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
			return disk.has(this.uri)
		}
		create() {
			disk.set(this.uri, "")
		}
		write(content: string | Uint8Array) {
			disk.set(this.uri, content)
		}
		textSync() {
			const content = disk.get(this.uri)
			if (content === undefined) throw new Error("missing file")
			return String(content)
		}
	}
	return { Directory, File, Paths: { cache: "cache", document: "documents" } }
})

const files = await import("./reader-files")

const client = (response: Response) =>
	({ assets: { download: vi.fn(async () => response) } }) as unknown as Parameters<
		typeof files.storeAsset
	>[2]

beforeEach(() => disk.clear())

describe("reader files", () => {
	it("stores an image once, named for WebKit, and never keeps an empty download", async () => {
		const folder = files.readerFolder("article-1")
		const png = client(
			new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
		)
		expect(await files.storeAsset(folder, "asset-1", png)).toBe("asset-1.png")
		expect(await files.storeAsset(folder, "asset-1", png)).toBe("asset-1.png")
		expect(png.assets.download).toHaveBeenCalledTimes(1)

		const empty = client(
			new Response(new Uint8Array(), { headers: { "content-type": "image/png" } }),
		)
		await expect(files.storeAsset(folder, "asset-2", empty)).rejects.toThrow("came back empty")
		expect(folder.list().map((file) => file.name)).toEqual(["asset-1.png"])
	})

	it("forgets every article read on this device at sign-out, and keeps the settings", () => {
		files.writePage(files.readerFolder("article-1"), "<p>one</p>")
		files.writePage(files.readerFolder("article-2"), "<p>two</p>")
		files.saveListLayout("list")
		files.forgetReadArticles()
		expect([...disk.keys()]).toEqual(["documents/list-layout.json"])
		files.forgetReadArticles()
	})

	it("reads back saved settings, and the defaults for missing or damaged ones", () => {
		expect(files.loadListLayout()).toBe("grid")
		expect(files.loadNotebookZoom()).toBe(false)
		expect(files.loadColorScheme()).toBe("system")
		expect(files.loadClipboardSeen()).toBeNull()

		files.saveListLayout("list")
		files.saveNotebookZoom(true)
		files.saveColorScheme("dark")
		files.saveClipboardSeen(42)
		files.saveTypePrefs({ ...files.loadTypePrefs(), sans: true })
		expect(files.loadListLayout()).toBe("list")
		expect(files.loadNotebookZoom()).toBe(true)
		expect(files.loadColorScheme()).toBe("dark")
		expect(files.loadClipboardSeen()).toBe(42)
		expect(files.loadTypePrefs().sans).toBe(true)

		disk.set("documents/clipboard-seen.json", "{not json")
		disk.set("documents/color-scheme.json", '"purple"')
		expect(files.loadClipboardSeen()).toBeNull()
		expect(files.loadColorScheme()).toBe("system")
	})
})
