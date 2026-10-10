import { existsSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { FsStorage } from "./fs"
import { S3Storage } from "./s3"
import type { Storage, StoredObject } from "./types"

export { FsStorage, S3Storage, type Storage, type StoredObject }

let singleton: Storage | undefined

/** Storage configured from STORAGE_DRIVER + S3_* / STORAGE_FS_ROOT env vars. */
export function getStorage(): Storage {
	singleton ??= storageFromEnv()
	return singleton
}

/** A wrong STORAGE_DRIVER is an error: a typo must not fall back to the local disk. */
export function storageFromEnv(env: Record<string, string | undefined> = process.env): Storage {
	const driver = env.STORAGE_DRIVER ?? "fs"
	if (driver === "s3") {
		const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } = env
		if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
			throw new Error(
				"STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY",
			)
		}
		return new S3Storage({
			endpoint: S3_ENDPOINT,
			bucket: S3_BUCKET,
			accessKeyId: S3_ACCESS_KEY_ID,
			secretAccessKey: S3_SECRET_ACCESS_KEY,
			region: S3_REGION,
		})
	}
	if (driver !== "fs") throw new Error(`STORAGE_DRIVER must be "fs" or "s3", not "${driver}"`)
	return new FsStorage(resolveFsRoot(env.STORAGE_FS_ROOT ?? "./storage"))
}

/**
 * Relative fs roots resolve against the workspace root (not the cwd), so web and worker processes
 * started from different package directories share one directory.
 */
function resolveFsRoot(root: string): string {
	if (isAbsolute(root)) return root
	let dir = process.cwd()
	for (let i = 0; i < 6; i++) {
		if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return resolve(dir, root)
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return resolve(process.cwd(), root)
}

/** Object key for a user's asset; content-addressed so identical bytes share one object. */
export function assetKey(userId: string, sha256: string, ext: string): string {
	return `u/${userId}/${sha256.slice(0, 2)}/${sha256}.${ext}`
}
