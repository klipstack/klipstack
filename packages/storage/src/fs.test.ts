import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { FsStorage } from "./fs"
import { assetKey } from "./index"

const root = await mkdtemp(join(tmpdir(), "klip-storage-"))
afterAll(() => rm(root, { recursive: true, force: true }))

describe("FsStorage", () => {
	const storage = new FsStorage(root)
	it("round-trips objects with content type", async () => {
		const key = assetKey("user1", "ab".repeat(32), "webp")
		await storage.put(key, Buffer.from("hello"), "image/webp")
		const got = await storage.get(key)
		expect(got?.contentType).toBe("image/webp")
		expect(got?.size).toBe(5)
		const chunks: Buffer[] = []
		for await (const c of got!.body) chunks.push(Buffer.from(c))
		expect(Buffer.concat(chunks).toString()).toBe("hello")
		await storage.delete(key)
		expect(await storage.get(key)).toBeNull()
	})
	it("refuses path traversal", async () => {
		await expect(storage.put("../../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow()
	})
	it("returns null for missing keys", async () => {
		expect(await storage.get("u/nobody/xx/missing.webp")).toBeNull()
	})
})
