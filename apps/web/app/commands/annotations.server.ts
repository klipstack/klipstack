import {
	HIGHLIGHT_NOTE_MAX,
	Id,
	NOTE_MAX,
	NUL_REFUSED,
	QUOTE_MAX,
	Time,
	withoutNul,
} from "@klipstack/api-contract"
import type { Highlight } from "@klipstack/db"
import { z } from "zod"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import { checkMayAdd } from "~/lib/limits.server"
import { internalizeReaderLinks } from "~/lib/note-links"
import { appOrigin } from "~/services/article-summary.server"
import { getDocument, type NoteState, setNote } from "~/services/documents.server"
import {
	createHighlight as insertHighlight,
	currentText,
	deleteHighlight as removeHighlight,
	getHighlightWithArticle,
	HIGHLIGHT_COLORS,
	type HighlightInput,
	resizeHighlight as moveHighlight,
	restoreHighlight as bringBack,
	updateHighlight as changeHighlight,
} from "~/services/highlights.server"
import { plainQuote } from "~/services/quotes"
import { NO_ARTICLE } from "./articles.server"

/**
 * Highlights and notes, for the web, the API and MCP alike. Notes are stored with note links: full
 * reader URLs (how clients show links) become `/read/<id>`, so they stay links between articles,
 * with backlinks.
 */

const NO_HIGHLIGHT = "No highlight with that id."

const one = (id: string) => parseInput(Id, id)
const noteText = (text: string) => internalizeReaderLinks(text, appOrigin)

const Color = z
	.number()
	.int()
	.min(0)
	.max(HIGHLIGHT_COLORS - 1)
const HighlightNote = z.string().max(HIGHLIGHT_NOTE_MAX).refine(withoutNul, NUL_REFUSED)

// ---- highlights ----

const NewHighlight = z.object({
	/** The passage as it reads in the article; whitespace, quote marks and case may differ. */
	exact: z
		.string()
		.max(QUOTE_MAX)
		.refine((text) => text.trim().length > 0, "The passage is empty."),
	/** Text around it, and where it is: the web sends them from the selection. */
	prefix: z.string().max(200).optional(),
	suffix: z.string().max(200).optional(),
	start: z.number().int().nonnegative().optional(),
	end: z.number().int().nonnegative().optional(),
	/** Which occurrence (1 = first in reading order), for a passage that appears more than once. */
	occurrence: z.number().int().min(1).optional(),
	color: Color.optional(),
	note: HighlightNote.nullish(),
})

export type NewHighlight = z.input<typeof NewHighlight>

/**
 * Highlights a passage of the user's article. The server resolves where it is against the article's
 * text, so every client gets the same anchors; a quote with Markdown in it (assistants copy it along)
 * is tried again without. A passage that appears more than once needs `occurrence`, or the refusal
 * (`ambiguous_quote`) lists each occurrence with its context.
 */
export async function createHighlight(
	userId: string,
	articleId: string,
	input: NewHighlight,
): Promise<Highlight> {
	const { occurrence, note, ...passage } = parseInput(NewHighlight, input)
	const documentId = one(articleId)
	await checkMayAdd(userId)
	const fields: Omit<HighlightInput, "exact"> = {
		prefix: passage.prefix,
		suffix: passage.suffix,
		color: passage.color,
		note: note ? noteText(note) : note,
	}
	const create = (exact: string, at: { start?: number; end?: number }) =>
		insertHighlight({ userId, documentId, input: { ...fields, exact, ...at } })
	let exact = passage.exact
	let result = await create(exact, { start: passage.start, end: passage.end })
	const plain = plainQuote(exact)
	if (!result.ok && result.error === "no_match" && plain !== exact.trim()) {
		exact = plain
		result = await create(exact, {})
	}
	if (!result.ok && result.error === "ambiguous") {
		const candidates = [...result.candidates].sort((a, b) => a.start - b.start)
		const chosen = occurrence ? candidates[occurrence - 1] : undefined
		if (!chosen) throw await ambiguous(userId, documentId, candidates, occurrence)
		result = await create(exact, chosen)
	}
	if (result.ok) return result.highlight
	switch (result.error) {
		case "not_found":
			throw notFound(NO_ARTICLE)
		case "not_ready":
			throw new AppError("not_ready", "The article text is not available yet. Try again later.")
		case "no_match":
			throw new AppError(
				"no_match",
				"That passage is not in the article. Quote it exactly, without Markdown symbols, within one paragraph.",
			)
		case "ambiguous":
			// A chosen occurrence resolves by position: still ambiguous would be a bug.
			throw new Error("a chosen occurrence was still ambiguous")
	}
}

async function ambiguous(
	userId: string,
	documentId: string,
	candidates: Array<{ start: number; end: number }>,
	occurrence: number | undefined,
): Promise<AppError> {
	const doc = await getDocument(userId, documentId)
	const text = (await currentText(documentId, doc?.currentVersionId ?? null))?.text
	const around = ({ start, end }: { start: number; end: number }) =>
		text
			? `…${text.slice(Math.max(0, start - 40), start)}[${text.slice(start, end)}]${text.slice(end, end + 40)}…`.replace(
					/\s+/g,
					" ",
				)
			: `characters ${start}–${end}`
	return new AppError(
		"ambiguous_quote",
		occurrence
			? `There are only ${candidates.length} occurrences of that passage.`
			: `That passage appears ${candidates.length} times. Pass occurrence to pick one.`,
		{
			details: {
				candidates: candidates.map((c, i) => ({ occurrence: i + 1, ...c, context: around(c) })),
			},
		},
	)
}

const HighlightChange = z
	.object({ note: HighlightNote.nullable().optional(), color: Color.optional() })
	.refine((v) => v.note !== undefined || v.color !== undefined, "Pass note or color.")

/** Changes a highlight's note (null removes it) or color. */
export async function updateHighlight(
	userId: string,
	id: string,
	input: z.input<typeof HighlightChange>,
): Promise<Highlight> {
	const { note, color } = parseInput(HighlightChange, input)
	const highlightId = one(id)
	if (!(await getHighlightWithArticle(userId, highlightId))) throw notFound(NO_HIGHLIGHT)
	const changed = await changeHighlight(userId, highlightId, {
		...(note !== undefined ? { note: note === null ? null : noteText(note) } : {}),
		...(color !== undefined ? { color } : {}),
	})
	if (!changed) throw notFound(NO_HIGHLIGHT)
	return changed
}

/** Deletes a highlight and its note; `restoreHighlight` brings it back. */
export async function deleteHighlight(userId: string, id: string): Promise<void> {
	const highlightId = one(id)
	if (!(await getHighlightWithArticle(userId, highlightId))) throw notFound(NO_HIGHLIGHT)
	await removeHighlight(userId, highlightId)
}

/** Undo of `deleteHighlight`, while its article is in the library. */
export async function restoreHighlight(userId: string, id: string): Promise<void> {
	if (!(await bringBack(userId, one(id)))) throw notFound(NO_HIGHLIGHT)
}

const Anchor = z.object({
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	exact: z.string().min(1).max(QUOTE_MAX),
})
const Resize = z.object({
	id: Id,
	/** The article version the new range indexes into. */
	versionId: Id,
	/** The range the reader started from: the change is refused when the highlight moved since. */
	previous: Anchor,
	selector: Anchor.extend({ prefix: z.string().max(200), suffix: z.string().max(200) }),
})

const RESIZE_REFUSALS = {
	not_found: [
		"not_found",
		"No highlight with that id in this article, or the article is not ready.",
	] as const,
	version_changed: [
		"version_changed",
		"The article changed since the page loaded. Load it again before adjusting the highlight.",
	] as const,
	highlight_changed: [
		"highlight_changed",
		"The highlight changed elsewhere since the page loaded. Nothing was changed.",
	] as const,
	invalid_range: ["invalid_range", `Select text between 1 and ${QUOTE_MAX} characters.`] as const,
	no_match: ["no_match", "That range does not match the article's text."] as const,
}

/** Moves a highlight's ends (the web reader's handles). */
export async function resizeHighlight(
	userId: string,
	articleId: string,
	input: z.input<typeof Resize>,
): Promise<Highlight> {
	const resize = parseInput(Resize, input)
	const result = await moveHighlight({ userId, documentId: one(articleId), ...resize })
	if (result.ok) return result.highlight
	const [code, message] = RESIZE_REFUSALS[result.error]
	throw new AppError(code, message)
}

// ---- the article note ----

const NoteText = z.string().max(NOTE_MAX).refine(withoutNul, NUL_REFUSED)

const NoteWrite = z.object({
	/** Blank or null clears it. */
	note: NoteText.nullable(),
	/**
	 * Given, the note is written only if it is still the one saved then: null means never saved.
	 * Otherwise the refusal (`note_changed`) carries the current note.
	 */
	expectedUpdatedAt: Time.nullable().optional(),
})

const noteChanged = (current: NoteState) =>
	new AppError("note_changed", "The note changed since it was read. Nothing was changed.", {
		details: {
			note: current.note,
			noteUpdatedAt: current.noteUpdatedAt?.toISOString() ?? null,
		},
	})

/** Writes the note on the whole article. */
export async function setArticleNote(
	userId: string,
	articleId: string,
	input: z.input<typeof NoteWrite>,
): Promise<NoteState> {
	const { note, expectedUpdatedAt } = parseInput(NoteWrite, input)
	// Deleting a note is tidying up; writing one is adding.
	if (note !== null) await checkMayAdd(userId)
	const saved = await setNote(userId, one(articleId), note === null ? null : noteText(note), {
		expectedUpdatedAt,
	})
	if (!saved) throw notFound(NO_ARTICLE)
	if (!saved.ok) throw noteChanged(saved.current)
	return { note: saved.note, noteUpdatedAt: saved.noteUpdatedAt }
}

const Paragraph = NoteText.transform((text) => text.trim()).refine(
	(text) => text.length > 0,
	"The paragraph is empty.",
)

/**
 * Adds a paragraph after the note. Each try writes only if the note is still the one it read, so a
 * save made meanwhile (the user typing, another client) is never lost; a try that lost reads again,
 * three times.
 */
export async function appendArticleNote(
	userId: string,
	articleId: string,
	text: string,
): Promise<NoteState> {
	const paragraph = noteText(parseInput(Paragraph, text))
	const documentId = one(articleId)
	await checkMayAdd(userId)
	let current: NoteState = { note: null, noteUpdatedAt: null }
	for (let attempt = 0; attempt < 3; attempt++) {
		const doc = await getDocument(userId, documentId)
		if (!doc) throw notFound(NO_ARTICLE)
		const note = [doc.note?.trim(), paragraph].filter(Boolean).join("\n\n")
		if (note.length > NOTE_MAX)
			throw new AppError(
				"note_too_long",
				`Notes are limited to ${NOTE_MAX} characters; with this paragraph it would have ${note.length}.`,
				{ details: { length: note.length } },
			)
		const saved = await setNote(userId, documentId, note, {
			expectedUpdatedAt: doc.noteUpdatedAt?.toISOString() ?? null,
		})
		if (!saved) throw notFound(NO_ARTICLE)
		if (saved.ok) return { note: saved.note, noteUpdatedAt: saved.noteUpdatedAt }
		current = saved.current
	}
	throw noteChanged(current)
}
