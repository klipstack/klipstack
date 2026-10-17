import { z } from "zod"
import { binary, defineEndpoint, empty, json } from "../endpoint"
import { Id } from "../schemas"

const params = z.object({ id: Id })

/** The languages a shared highlight's page speaks. */
export const SHARE_LOCALES = ["en", "es"] as const

/** A highlight's live public link. */
export const LiveShare = z
	.object({
		removed: z.literal(false),
		publicId: z.string(),
		/** The public page's address, absolute. */
		url: z.string(),
		/** Whether the page shows the note. */
		includeNote: z.boolean(),
		/** The quote or the note changed since: the page shows the older one until updated. */
		changed: z.boolean(),
	})
	.meta({ id: "LiveShare" })
export type LiveShare = z.infer<typeof LiveShare>

/**
 * A highlight's public link: live, or taken down by an admin after a report (it cannot be shared
 * again). Null: not shared.
 */
export const HighlightShare = z
	.union([LiveShare, z.object({ removed: z.literal(true) })])
	.nullable()
export type HighlightShare = z.infer<typeof HighlightShare>

const ShareAnswer = z.object({ share: HighlightShare })

export const getHighlightShare = defineEndpoint({
	id: "highlights.getShare",
	method: "GET",
	path: "/highlights/:id/share",
	scope: "read",
	summary: "The highlight's public link: live, taken down, or null when it is not shared.",
	params,
	response: json(ShareAnswer),
	errors: ["not_found"],
})

export const shareHighlight = defineEndpoint({
	id: "highlights.share",
	method: "PUT",
	path: "/highlights/:id/share",
	scope: "write",
	summary:
		"Shares the highlight at a public link (/h/{publicId}), a snapshot of it as it is now; shared already, updates what the page shows, at the same address.",
	params,
	body: z.object({
		/** Whether the page shows the note. */
		includeNote: z.boolean(),
		/** The language the page speaks, whoever visits. */
		locale: z.enum(SHARE_LOCALES).default("en"),
	}),
	response: json(z.object({ share: LiveShare })),
	/**
	 * `limit_reached`: a new link past the monthly cap (`details.limit` "shares"); an update is
	 * not counted. `share_removed`: an admin took it down.
	 */
	errors: ["not_found", "limit_reached", "share_removed"],
})

export const stopSharingHighlight = defineEndpoint({
	id: "highlights.stopSharing",
	method: "DELETE",
	path: "/highlights/:id/share",
	scope: "write",
	summary:
		"Takes the highlight's public page down: its address answers that it is no longer shared.",
	params,
	response: empty(),
	/** `not_found`: also when it is not shared. */
	errors: ["not_found"],
})

export const HIGHLIGHT_IMAGE_SHAPES = ["wide", "tall"] as const

export const highlightImage = defineEndpoint({
	id: "highlights.image",
	method: "GET",
	path: "/highlights/:id/image.png",
	scope: "read",
	summary:
		"The highlight as a PNG to share by itself, as it is now: wide (1200×630) or tall (1080×1920), with its note or without. Needs no public link.",
	params,
	query: z.object({
		shape: z.enum(HIGHLIGHT_IMAGE_SHAPES).default("wide"),
		note: z.stringbool().default(true),
	}),
	response: binary(),
	/** `cannot_draw`: the quote has characters the image's fonts do not have. */
	errors: ["not_found", "cannot_draw"],
})

/** More than one note's links ever are. */
export const NOTE_LINKS_MAX = 500

export const lookupNoteLinks = defineEndpoint({
	id: "noteLinks.lookup",
	method: "POST",
	path: "/note-links/lookup",
	scope: "read",
	summary:
		"The original address of each article a note links to, by id, for sharing the note: its links then lead somewhere for anyone. One in the trash still has its address; another reader's article, or one purged, is left out.",
	body: z.object({ ids: z.array(Id).max(NOTE_LINKS_MAX) }),
	response: json(z.object({ urls: z.record(z.string(), z.string()) })),
	errors: [],
})
