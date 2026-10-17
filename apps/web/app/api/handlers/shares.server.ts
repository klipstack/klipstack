import type {
	getHighlightShare,
	highlightImage,
	lookupNoteLinks,
	shareHighlight,
	stopSharingHighlight,
} from "@klipstack/api-contract"
import {
	shareHighlight as shareHighlightCommand,
	stopSharingHighlight as stopSharingCommand,
} from "~/commands/highlight-shares.server"
import { env } from "~/lib/env.server"
import { drawHighlightImage } from "~/services/highlight-image.server"
import { getShareState, type ShareState } from "~/services/highlight-shares.server"
import { getHighlightWithArticle } from "~/services/highlights.server"
import { linkTargetDetails } from "~/services/links.server"
import { notFound } from "../errors.server"
import type { Handler } from "../handler.server"

const NO_HIGHLIGHT = "No highlight with that id."

/** A live share as the API shows it: its address absolute, for apps. */
const live = (state: ShareState) => ({ ...state, url: new URL(state.url, env.APP_URL).href })

export const getShare: Handler<typeof getHighlightShare> = async ({ userId, params }) => {
	if (!(await getHighlightWithArticle(userId, params.id))) throw notFound(NO_HIGHLIGHT)
	const state = await getShareState(userId, params.id)
	return { share: state && !state.removed ? live(state) : state }
}

export const share: Handler<typeof shareHighlight> = async ({ userId, params, body }) => ({
	share: live(await shareHighlightCommand(userId, params.id, body)),
})

export const stopSharing: Handler<typeof stopSharingHighlight> = async ({ userId, params }) => {
	await stopSharingCommand(userId, params.id)
}

export const image: Handler<typeof highlightImage> = async ({ userId, params, query }) => {
	const png = await drawHighlightImage(userId, params.id, {
		shape: query.shape,
		withNote: query.note,
	})
	return new Response(new Uint8Array(png), {
		headers: {
			"content-type": "image/png",
			"content-length": String(png.length),
			"cache-control": "private, no-store",
		},
	})
}

export const noteLinks: Handler<typeof lookupNoteLinks> = async ({ userId, body }) => {
	const targets = await linkTargetDetails(userId, body.ids)
	return { urls: Object.fromEntries(Object.entries(targets).map(([id, t]) => [id, t.url])) }
}
