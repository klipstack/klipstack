import { and, assets, db, eq, inArray } from "@klipstack/db"
import type { NumberedImages } from "./images"

/** The user's asset rows for these numbered images; rows that are gone are left out. */
export async function findAssets(userId: string, { images }: NumberedImages) {
	const ids = [...new Set(images.map((i) => i.assetId))]
	if (ids.length === 0) return []
	return db
		.select({
			id: assets.id,
			storageKey: assets.storageKey,
			contentType: assets.contentType,
			bytes: assets.bytes,
			width: assets.width,
			height: assets.height,
		})
		.from(assets)
		.where(and(eq(assets.userId, userId), inArray(assets.id, ids)))
}

/** Size of the user's stored copies among these images; missing ones are left out. */
export async function storedSizes(userId: string, numbered: NumberedImages) {
	const rows = await findAssets(userId, numbered)
	return new Map(rows.map((r) => [r.id, { width: r.width, height: r.height, bytes: r.bytes }]))
}
