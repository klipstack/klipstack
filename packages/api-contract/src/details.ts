import { z } from "zod"
import type { ErrorCode } from "./errors"
import { Note } from "./schemas"

/** The shape of `error.details` for the codes that carry them. */

export const InvalidRequestDetails = z
	.object({
		/** Where the request broke its shape. Absent when the change itself was refused, past that. */
		where: z.enum(["params", "query", "body"]).optional(),
		/** zod issues: where (`path`) and why (`message`), plus zod's own fields. */
		issues: z.array(
			z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }),
		),
	})
	.meta({ id: "InvalidRequestDetails" })

/** `409 note_changed`: the note as it is now. */
export const NoteChangedDetails = Note

export const AmbiguousQuoteDetails = z
	.object({
		/** Every occurrence, in reading order; pass one's `occurrence` to pick it. */
		candidates: z.array(
			z.object({
				occurrence: z.number().int().min(1),
				/** "…text before[the passage]text after…" */
				context: z.string(),
				/** Where it is in the article's text, in characters. */
				start: z.number().int(),
				end: z.number().int(),
			}),
		),
	})
	.meta({ id: "AmbiguousQuoteDetails" })

export const ChooseFeedDetails = z
	.object({
		/** The feeds the site links; follow one of their URLs. */
		choices: z.array(z.object({ url: z.string(), title: z.string().nullable() })),
	})
	.meta({ id: "ChooseFeedDetails" })

/**
 * `409 tag_in_saved_searches`: the saved searches whose query names the tag (`tag:` or `-tag:`).
 * Deleted anyway (`force`), the tag leaves them as they are: they find nothing until a tag has the
 * name again.
 */
export const TagInSavedSearchesDetails = z
	.object({
		savedSearches: z.array(z.object({ id: z.string(), name: z.string(), query: z.string() })),
	})
	.meta({ id: "TagInSavedSearchesDetails" })

/** `409 already_saved`: the article in the library saved from the same page. */
export const AlreadySavedDetails = z
	.object({ articleId: z.string() })
	.meta({ id: "AlreadySavedDetails" })

/** `422 too_many_article_tags`: the article that would have more tags than it may. */
export const TooManyArticleTagsDetails = z
	.object({ articleId: z.string() })
	.meta({ id: "TooManyArticleTagsDetails" })

/** `422 note_too_long`: how long the note would have been. */
export const NoteTooLongDetails = z
	.object({ length: z.number().int() })
	.meta({ id: "NoteTooLongDetails" })

/** `426 client_outdated`: the oldest version of the app that still works. */
export const ClientOutdatedDetails = z
	.object({ minimum: z.string() })
	.meta({ id: "ClientOutdatedDetails" })

export const ERROR_DETAILS = {
	invalid_request: InvalidRequestDetails,
	already_saved: AlreadySavedDetails,
	too_many_article_tags: TooManyArticleTagsDetails,
	note_too_long: NoteTooLongDetails,
	client_outdated: ClientOutdatedDetails,
	note_changed: NoteChangedDetails,
	ambiguous_quote: AmbiguousQuoteDetails,
	choose_feed: ChooseFeedDetails,
	tag_in_saved_searches: TagInSavedSearchesDetails,
} as const satisfies Partial<Record<ErrorCode, z.ZodType>>

export type DetailedErrorCode = keyof typeof ERROR_DETAILS
export type ErrorDetails<C extends DetailedErrorCode> = z.infer<(typeof ERROR_DETAILS)[C]>
