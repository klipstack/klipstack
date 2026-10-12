import { isLocale } from "@klipstack/i18n/languages"
import { data } from "react-router"
import sharp from "sharp"
import { editionCardPng, exampleCard } from "~/lib/edition-card.server"
import { EDITION_COVERS } from "~/lib/editions"
import { getInstance } from "~/lib/i18n.server"
import type { Route } from "./+types/edition-cover-example"

/** Drawn once per cover and language, while the server runs. */
const drawn = new Map<string, Promise<Buffer>>()

/**
 * GET /edition-covers/:cover-:lang.png — what a cover looks like, for the editor's picker: an
 * example edition, half size. Not the user's edition, so anyone may see it. Drawn once per server;
 * browsers don't keep it, as the session middleware says `no-store` for every response.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
	const [, cover, lang] = /^([a-z]+)-([a-z]+)\.png$/.exec(params.name) ?? []
	const known = (EDITION_COVERS as readonly string[]).includes(cover ?? "")
	if (!known || !isLocale(lang)) throw data(null, { status: 404 })
	const key = `${cover}-${lang}`
	let png = drawn.get(key)
	if (!png) {
		const t = getInstance(context).getFixedT(lang, "editions")
		png = editionCardPng(exampleCard(cover as (typeof EDITION_COVERS)[number], lang, t)).then(
			(full) => sharp(full).resize(600, 315).png({ compressionLevel: 9 }).toBuffer(),
		)
		png.catch(() => drawn.delete(key))
		drawn.set(key, png)
	}
	const bytes = await png
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "image/png",
			"Content-Length": String(bytes.length),
		},
	})
}
