import { ArticleTitle, BATCH_MAX, Ids, QUOTE_MAX, TagNames, URL_MAX } from "@klipstack/api-contract"
import {
	cleanTagName,
	HIGHLIGHT_NOTE_MAX,
	NUL_REFUSED,
	withoutNul,
} from "@klipstack/api-contract/names"
import { TRASH_RETENTION_DAYS } from "@klipstack/api-contract/names"
import { NOTE_MAX } from "@klipstack/api-contract/names"
import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import {
	appendArticleNote,
	createHighlight,
	deleteHighlight,
	setArticleNote,
	updateHighlight,
} from "~/commands/annotations.server"
import { trashArticles, updateArticles } from "~/commands/articles.server"
import { saveArticle } from "~/commands/saving.server"
import { createTag, deleteTag, renameTag } from "~/commands/tags.server"
import { AppError } from "~/lib/app-error"
import { HIGHLIGHT_COLOR_NAMES } from "~/lib/highlight-colors"
import { getDocument } from "../documents.server"
import type { SavedSearchRow } from "../saved-searches.server"
import { findTagByName } from "../tags.server"
import { uuid } from "./ids"
import { articleSummary, json, NOTE_LINKS_HINT, readerUrl, toolError } from "./results.server"

/** Tools here that change the library (scope library:write). */
export const ARTICLE_WRITE_TOOLS: ReadonlySet<string> = new Set([
	"save_article",
	"update_articles",
	"update_article_note",
	"add_highlight",
	"update_highlight",
	"delete_highlight",
	"trash_articles",
	"create_tag",
	"rename_tag",
	"delete_tag",
])

const WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
} as const

const color = z.enum(HIGHLIGHT_COLOR_NAMES)
const colorIndex = (name: z.infer<typeof color> | undefined) =>
	name === undefined ? undefined : HIGHLIGHT_COLOR_NAMES.indexOf(name)

/** Most articles one call may change. */
const articleIds = Ids

const tagName = z
	.string()
	.max(200)
	.refine((name) => cleanTagName(name) !== null, "Not a tag name")
const NO_TAG = "The user has no tag with that name. list_tags names them."

const NO_WRITE = "This connection may only read the library."

export function registerWriteTools(server: McpServer, userId: string, canWrite: boolean) {
	server.registerTool(
		"save_article",
		{
			title: "Save article",
			description:
				"Saves a web page to the user's library. Klipstack fetches and extracts it in the background: the result has the article id; its text is available through get_article a few seconds later. Saving a URL that is already in the library returns the existing article.",
			inputSchema: z.object({ url: z.string().trim().min(1).max(URL_MAX) }),
			annotations: { ...WRITE, idempotentHint: true, openWorldHint: true },
		},
		async ({ url }) => {
			if (!canWrite) return toolError(NO_WRITE)
			const { article, created } = await saveArticle(userId, { url, source: "api" })
			return json({
				id: article.id,
				created,
				status: article.status,
				klipstackUrl: readerUrl(article.id),
			})
		},
	)

	server.registerTool(
		"update_articles",
		{
			title: "Update articles",
			description: `Changes up to ${BATCH_MAX} articles at once: move them between library and archive, star or unstar them, mark them for the user's next edition (shortlisted; the edition is the public page of articles they share) or take that mark off, mark them finished (which also archives them) or unread, add tags or remove them. With a single article, it can also rename it. Pass only the fields to change; they apply to every article given. addTags makes the tags that do not exist yet, and names match whatever their case: call list_tags first and reuse the user's tags before making new ones. The result lists the updated articles and any ids not found.`,
			inputSchema: z.object({
				ids: articleIds,
				location: z.enum(["inbox", "archive"]).optional(),
				starred: z.boolean().optional(),
				shortlisted: z.boolean().optional(),
				finished: z.boolean().optional(),
				title: ArticleTitle.optional(),
				addTags: TagNames.optional(),
				removeTags: TagNames.optional(),
			}),
			annotations: { ...WRITE, idempotentHint: true },
		},
		async (input) => {
			if (!canWrite) return toolError(NO_WRITE)
			const { found, notFound } = await updateArticles(userId, input)
			const items = []
			for (const id of found) {
				const doc = await getDocument(userId, id)
				if (doc) items.push(articleSummary(doc))
			}
			return json({ items, notFound })
		},
	)

	server.registerTool(
		"update_article_note",
		{
			title: "Update article note",
			description: `Writes the user's note on a whole article (Markdown). append (the default) adds a paragraph after the existing note; replace overwrites the note the user wrote, and an empty text clears it. ${NOTE_LINKS_HINT}`,
			inputSchema: z.object({
				id: uuid(),
				text: z.string().max(NOTE_MAX).refine(withoutNul, NUL_REFUSED),
				mode: z.enum(["append", "replace"]).default("append"),
				expected_updated_at: z
					.string()
					.nullable()
					.optional()
					.describe(
						"replace only: the note's updatedAt as get_article returned it (null: never written). The note is replaced only if it has not changed since; otherwise nothing changes and the error says so.",
					),
			}),
			annotations: WRITE,
		},
		async ({ id, text, mode, expected_updated_at }) => {
			if (!canWrite) return toolError(NO_WRITE)
			const saved =
				mode === "append"
					? await appendArticleNote(userId, id, text)
					: await setArticleNote(userId, id, {
							note: text,
							expectedUpdatedAt: expected_updated_at,
						})
			return json({ id, note: saved.note, updatedAt: saved.noteUpdatedAt?.toISOString() ?? null })
		},
	)

	server.registerTool(
		"add_highlight",
		{
			title: "Add highlight",
			description: `Highlights a passage of an article, optionally with a note. quote must be the passage's exact text as it reads in the article, without Markdown symbols; whitespace, quote marks and case may differ. If the passage appears more than once, the result lists each occurrence: call again with occurrence set to the one you mean. ${NOTE_LINKS_HINT}`,
			inputSchema: z.object({
				article_id: uuid(),
				quote: z.string().trim().min(1).max(QUOTE_MAX),
				note: z.string().max(HIGHLIGHT_NOTE_MAX).refine(withoutNul, NUL_REFUSED).optional(),
				color: color.optional(),
				occurrence: z.number().int().min(1).optional().describe("1 = first in reading order"),
			}),
			annotations: WRITE,
		},
		async ({ article_id, quote, note, color, occurrence }) => {
			if (!canWrite) return toolError(NO_WRITE)
			try {
				const h = await createHighlight(userId, article_id, {
					exact: quote,
					occurrence,
					note,
					color: colorIndex(color),
				})
				return json({
					id: h.id,
					articleId: h.documentId,
					quote: h.exact,
					note: h.note,
					color: HIGHLIGHT_COLOR_NAMES[h.color],
					createdAt: h.createdAt.toISOString(),
					updatedAt: h.updatedAt.toISOString(),
				})
			} catch (error) {
				// The occurrences, numbered, for the assistant to pick one.
				if (error instanceof AppError && error.code === "ambiguous_quote")
					return toolError(ambiguityMessage(error, occurrence))
				throw error
			}
		},
	)

	server.registerTool(
		"update_highlight",
		{
			title: "Update highlight",
			description: `Changes a highlight's note (replacing it; null removes it) or color. Highlight ids come from list_highlights. ${NOTE_LINKS_HINT}`,
			inputSchema: z
				.object({
					id: uuid(),
					note: z
						.string()
						.max(HIGHLIGHT_NOTE_MAX)
						.refine(withoutNul, NUL_REFUSED)
						.nullable()
						.optional(),
					color: color.optional(),
				})
				.refine((v) => "note" in v || "color" in v, "Pass note or color"),
			annotations: { ...WRITE, idempotentHint: true },
		},
		async ({ id, note, color }) => {
			if (!canWrite) return toolError(NO_WRITE)
			const h = await updateHighlight(userId, id, { note, color: colorIndex(color) })
			return json({
				id: h.id,
				quote: h.exact,
				note: h.note,
				color: HIGHLIGHT_COLOR_NAMES[h.color],
				createdAt: h.createdAt.toISOString(),
				updatedAt: h.updatedAt.toISOString(),
			})
		},
	)

	server.registerTool(
		"delete_highlight",
		{
			title: "Delete highlight",
			description: "Deletes a highlight and its note. Confirm with the user first.",
			inputSchema: z.object({ id: uuid() }),
			annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
		},
		async ({ id }) => {
			if (!canWrite) return toolError(NO_WRITE)
			await deleteHighlight(userId, id)
			return json({ id, deleted: true })
		},
	)

	server.registerTool(
		"trash_articles",
		{
			title: "Move articles to trash",
			description: `Moves up to ${BATCH_MAX} articles, with their highlights and notes, to the trash. The user can restore them from the trash in Klipstack for ${TRASH_RETENTION_DAYS} days; then they are deleted for good. Confirm with the user first.`,
			inputSchema: z.object({ ids: articleIds }),
			annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
		},
		async ({ ids }) => {
			if (!canWrite) return toolError(NO_WRITE)
			const { trashed, notFound } = await trashArticles(userId, ids)
			return json({ trashed, notFound, restorableForDays: TRASH_RETENTION_DAYS })
		},
	)

	// Tags go by name here, as they do in update_articles and in tag: searches.
	server.registerTool(
		"create_tag",
		{
			title: "Create tag",
			description:
				"Makes a tag with no articles yet. Rarely needed: update_articles with addTags makes the tags it needs. Use it to set up names the user asked for before there is anything to put them on. A name the user has already, whatever its case, answers with that tag and created: false. Names have up to 50 characters, and no double quote or comma.",
			inputSchema: z.object({ name: tagName }),
			annotations: { ...WRITE, idempotentHint: true },
		},
		async ({ name }) => {
			if (!canWrite) return toolError(NO_WRITE)
			const { tag, created } = await createTag(userId, name)
			return json({ name: tag.name, articles: tag.articles, created })
		},
	)

	server.registerTool(
		"rename_tag",
		{
			title: "Rename or merge tag",
			description:
				"Renames a tag; every article that has it keeps it under the new name. When new_name is the name of another tag (whatever its case), the two merge: that tag gets this one's articles, this one goes, and the result has merged: true. Merging cannot be undone: confirm with the user first. A change of case only is a rename.",
			inputSchema: z.object({ name: tagName, new_name: tagName }),
			annotations: { ...WRITE, destructiveHint: true },
		},
		async ({ name, new_name }) => {
			if (!canWrite) return toolError(NO_WRITE)
			const tag = await findTagByName(userId, name)
			if (!tag) return toolError(NO_TAG)
			const renamed = await renameTag(userId, tag.id, new_name)
			return json({
				name: renamed.tag.name,
				articles: renamed.tag.articles,
				merged: renamed.merged,
			})
		},
	)

	server.registerTool(
		"delete_tag",
		{
			title: "Delete tag",
			description:
				"Deletes a tag. Its articles stay in the library, without it. This cannot be undone: confirm with the user first. A tag the user's saved searches name (tag: or -tag:) is not deleted: the error lists those searches. Without the tag they would find nothing; tell the user, and call again with force: true only once they agree. To take a tag off some articles only, use update_articles with removeTags.",
			inputSchema: z.object({
				name: tagName,
				force: z
					.boolean()
					.default(false)
					.describe(
						"Delete the tag even though saved searches name it. They stay, and find nothing. Only after the user agreed.",
					),
			}),
			annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
		},
		async ({ name, force }) => {
			if (!canWrite) return toolError(NO_WRITE)
			const tag = await findTagByName(userId, name)
			if (!tag) return toolError(NO_TAG)
			try {
				const deleted = await deleteTag(userId, tag.id, { force })
				return json({ name: deleted.name, deleted: true, articlesUntagged: deleted.articles })
			} catch (error) {
				if (error instanceof AppError && error.code === "tag_in_saved_searches")
					return toolError(
						savedSearchesMessage(tag.name, error.details?.savedSearches as SavedSearchRow[]),
					)
				throw error
			}
		},
	)
}

/** The saved searches that keep a tag from being deleted, with their queries, and what to do. */
function savedSearchesMessage(tag: string, searches: SavedSearchRow[]): string {
	const lines = searches.map((s) => `- ${s.name}: ${s.query}`)
	return [
		`Not deleted: the user's saved searches below name the tag ${tag}, and would find nothing without it. Tell the user; if they still want the tag gone, call again with force: true.`,
		...lines,
	].join("\n")
}

/** Lists each occurrence with some text around it, so the assistant can pick one. */
function ambiguityMessage(error: AppError, occurrence: number | undefined): string {
	const candidates = (error.details?.candidates ?? []) as Array<{
		occurrence: number
		context: string
	}>
	const intro = occurrence
		? `There are only ${candidates.length} occurrences of that passage.`
		: `That passage appears ${candidates.length} times. Call again with occurrence set to the one to highlight:`
	return [intro, ...candidates.map((c) => `${c.occurrence}. ${c.context}`)].join("\n")
}
