import { z } from "zod"
import { defineEndpoint, json } from "../endpoint"
import { STARTER_LANGUAGES, STARTER_TOPICS } from "../enums"
import { STARTER_SLUG_MAX } from "../names"
import { Id } from "../schemas"

/**
 * The starter texts, as the web's Discover page (/texts) and Home show them to a reader with
 * nothing to read: the guide to Klipstack and short texts to try it on, public-domain ones that
 * ship with the server and a few on the sites that publish them, on shelves by topic, in English
 * and Spanish.
 */

/** A starter text, and the reader's copy of it when they have one. */
export const StarterText = z
	.object({
		/** Its name: what POST /starter-texts/:slug/save takes. */
		slug: z.string(),
		/**
		 * `guide`: the guide to Klipstack. `text`: a public-domain text that ships with the server, saved
		 * without fetching anything. `link`: a text on the site that publishes it (`site`), fetched from
		 * there when saved.
		 */
		kind: z.enum(["guide", "text", "link"]),
		language: z.enum(STARTER_LANGUAGES),
		/** Its shelf; null for the guide. */
		topic: z.enum(STARTER_TOPICS).nullable(),
		title: z.string(),
		author: z.string().nullable(),
		/** A line about it. */
		description: z.string().nullable(),
		/** Minutes to read it, at least 1. */
		minutes: z.number().int().positive(),
		/** A `link`'s site, as a book names it (`paulgraham.com`); null for the others. */
		site: z.string().nullable(),
		/** The reader's copy, in the library and not in the trash; null without one. */
		articleId: Id.nullable(),
	})
	.meta({ id: "StarterText" })
export type StarterText = z.infer<typeof StarterText>

export const listStarterTexts = defineEndpoint({
	id: "starterTexts.list",
	method: "GET",
	path: "/starter-texts",
	scope: "read",
	summary:
		"Every starter text in one language, as the web's Discover page shows them: the guide, then one shelf per topic, each shortest first. The texts are in `language`, the account's language by default; the guide is always in the account's language, since it is about the app. `guideFirst` says whether to show the guide before the shelves: for a reader who has neither the guide nor 10 articles of their own (the trash and starter texts aside).",
	query: z.object({
		/** The texts' language; the account's by default. */
		language: z.enum(STARTER_LANGUAGES).optional(),
	}),
	response: json(
		z.object({
			/** The texts' language. */
			language: z.enum(STARTER_LANGUAGES),
			/** The account's language: the guide's, and the one to show by default. */
			readerLanguage: z.enum(STARTER_LANGUAGES),
			guide: StarterText,
			guideFirst: z.boolean(),
			/** In the order shown; topics with no texts in `language` are left out. */
			shelves: z.array(z.object({ topic: z.enum(STARTER_TOPICS), items: z.array(StarterText) })),
		}),
	),
	errors: [],
})

export const getStarterOffer = defineEndpoint({
	id: "starterTexts.offer",
	method: "GET",
	path: "/starter-texts/offer",
	scope: "read",
	summary:
		"What the web's Home offers when there is nothing to read (nothing saved, or everything finished), in the account's language: the guide, while the reader doesn't have it and has fewer than 10 articles of their own, and up to 4 texts that ship with the server they don't have, one from each topic in turn. Both empty once the reader has them all.",
	response: json(
		z.object({
			guide: StarterText.nullable(),
			texts: z.array(StarterText),
		}),
	),
	errors: [],
})

export const saveStarterText = defineEndpoint({
	id: "starterTexts.save",
	method: "POST",
	path: "/starter-texts/:slug/save",
	scope: "write",
	summary:
		"Adds a starter text to the library, as the web's Discover page does: a `text` or the guide from the page that ships with the server, a `link` from its site. One the reader has already (not in the trash) is left as it is, highlights, notes and all, and `created` is false; a `link` is saved as any link, so one whose fetch failed is fetched again. Counts against the saves of the month, as any save.",
	params: z.object({ slug: z.string().min(1).max(STARTER_SLUG_MAX) }),
	// Adding one already there returns the same article.
	retryOnCutoff: true,
	response: json(z.object({ articleId: Id, created: z.boolean() })),
	/** `not_found`: no starter text has that slug. */
	errors: ["not_found", "limit_reached", "subscription_required"],
})
