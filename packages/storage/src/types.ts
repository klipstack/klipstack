import type { Readable } from "node:stream"

export interface StoredObject {
	body: Readable
	contentType: string | null
	size: number | null
}

export interface Storage {
	readonly driver: "fs" | "s3"
	put(key: string, data: Buffer, contentType: string): Promise<void>
	get(key: string): Promise<StoredObject | null>
	delete(key: string): Promise<void>
}
