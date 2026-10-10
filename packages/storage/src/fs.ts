import { createReadStream } from "node:fs"
import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, normalize, resolve, sep } from "node:path"
import type { Storage, StoredObject } from "./types"

/** Local filesystem storage. Dev and single-machine only; not shared across Fly machines. */
export class FsStorage implements Storage {
	readonly driver = "fs" as const
	private readonly root: string

	constructor(root: string) {
		this.root = resolve(root)
	}

	private pathFor(key: string): string {
		if (!key || key.includes("\0")) throw new Error(`invalid storage key: ${key}`)
		const full = resolve(this.root, normalize(key))
		if (!full.startsWith(this.root + sep)) throw new Error(`invalid storage key: ${key}`)
		return full
	}

	async put(key: string, data: Buffer, contentType: string): Promise<void> {
		const path = this.pathFor(key)
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, data)
		await writeFile(`${path}.meta`, JSON.stringify({ contentType, size: data.byteLength }))
	}

	async get(key: string): Promise<StoredObject | null> {
		const path = this.pathFor(key)
		try {
			const info = await stat(path)
			let contentType: string | null = null
			try {
				const meta = JSON.parse(
					await (await import("node:fs/promises")).readFile(`${path}.meta`, "utf8"),
				) as { contentType?: string }
				contentType = meta.contentType ?? null
			} catch {
				contentType = null
			}
			return { body: createReadStream(path), contentType, size: info.size }
		} catch {
			return null
		}
	}

	async delete(key: string): Promise<void> {
		const path = this.pathFor(key)
		await rm(path, { force: true })
		await rm(`${path}.meta`, { force: true })
	}
}
