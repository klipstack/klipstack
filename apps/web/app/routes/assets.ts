import { Readable } from "node:stream"
import { and, assets, db, eq } from "@klipstack/db"
import { getStorage } from "@klipstack/storage"
import { isUuid } from "~/lib/page-cursor"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/assets"

/**
 * GET /assets/:id — serve a rehosted image to its owner. Content-addressed and immutable, so the
 * private offline cache may retain it. The server always checks ownership, including for S3.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const asset = isUuid(params.id)
		? await db.query.assets.findFirst({
				where: and(eq(assets.id, params.id), eq(assets.userId, user.id)),
			})
		: undefined
	if (!asset) throw new Response("Not found", { status: 404 })

	const etag = `"${asset.sha256}"`
	if (request.headers.get("if-none-match") === etag)
		return new Response(null, { status: 304, headers: { etag } })

	const storage = getStorage()
	const object = await storage.get(asset.storageKey)
	if (!object) throw new Response("Not found", { status: 404 })
	const headers = new Headers({
		"content-type": object.contentType ?? asset.contentType,
		"cache-control": "private, no-store",
		etag,
		"x-content-type-options": "nosniff",
		"content-security-policy": "default-src 'none'; sandbox",
	})
	if (object.size) headers.set("content-length", String(object.size))
	return new Response(Readable.toWeb(object.body) as ReadableStream, { headers })
}
