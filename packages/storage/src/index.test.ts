import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FsStorage, S3Storage, storageFromEnv } from "./index"

const S3 = {
	STORAGE_DRIVER: "s3",
	S3_ENDPOINT: "https://s3.example",
	S3_BUCKET: "b",
	S3_ACCESS_KEY_ID: "id",
	S3_SECRET_ACCESS_KEY: "secret",
}

describe("storageFromEnv", () => {
	it("uses the disk by default and for `fs`", () => {
		const root = mkdtempSync(join(tmpdir(), "storage-env-"))
		expect(storageFromEnv({ STORAGE_FS_ROOT: root })).toBeInstanceOf(FsStorage)
		expect(storageFromEnv({ STORAGE_DRIVER: "fs", STORAGE_FS_ROOT: root })).toBeInstanceOf(
			FsStorage,
		)
	})
	it("builds S3 storage when its settings are all there", () => {
		expect(storageFromEnv(S3)).toBeInstanceOf(S3Storage)
	})
	it("names the missing S3 settings", () => {
		expect(() => storageFromEnv({ ...S3, S3_BUCKET: undefined })).toThrow("S3_BUCKET")
	})
	it("refuses a driver it does not know instead of using the disk", () => {
		expect(() => storageFromEnv({ STORAGE_DRIVER: "S3" })).toThrow('"S3"')
	})
})
