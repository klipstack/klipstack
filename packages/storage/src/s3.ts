import type { Readable } from "node:stream"
import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3"
import type { Storage, StoredObject } from "./types"

export interface S3Options {
	endpoint: string
	bucket: string
	accessKeyId: string
	secretAccessKey: string
	region?: string
}

/** S3-compatible storage (Cloudflare R2, AWS S3, MinIO). */
export class S3Storage implements Storage {
	readonly driver = "s3" as const
	private readonly client: S3Client
	private readonly bucket: string

	constructor(options: S3Options) {
		this.client = new S3Client({
			region: options.region ?? "auto",
			endpoint: options.endpoint,
			credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
			forcePathStyle: true,
		})
		this.bucket = options.bucket
	}

	async put(key: string, data: Buffer, contentType: string): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: data,
				ContentType: contentType,
				CacheControl: "private, no-store",
			}),
		)
	}

	async get(key: string): Promise<StoredObject | null> {
		try {
			const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
			if (!res.Body) return null
			return {
				body: res.Body as Readable,
				contentType: res.ContentType ?? null,
				size: res.ContentLength ?? null,
			}
		} catch (error) {
			if ((error as { name?: string }).name === "NoSuchKey") return null
			throw error
		}
	}

	async delete(key: string): Promise<void> {
		await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
	}
}
