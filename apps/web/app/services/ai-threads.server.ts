import { citationRange } from "@klipstack/ai"
import { resolveSelector, selectorFor } from "@klipstack/anchor"
import {
	type AiBrief,
	type AiCitation,
	aiBriefs,
	type AiMessage,
	type AiThread,
	type AiThreadAction,
	aiMessages,
	aiThreads,
	and,
	asc,
	db,
	desc,
	documents,
	eq,
	inArray,
	isNotNull,
	isNull,
	sql,
	type Tx,
} from "@klipstack/db"
import { currentText } from "./highlights.server"

/** A thread and its turns, oldest first. */
export type ThreadWithMessages = AiThread & { messages: AiMessage[] }

export interface NewThread {
	userId: string
	documentId: string
	versionId: string
	start: number
	end: number
	text: string
	action: AiThreadAction
	highlightId?: string | null
}

/** Starts a thread on a range of the version's text, with the selector made from that text. */
export async function insertThread(tx: Tx, input: NewThread): Promise<AiThread> {
	const selector = selectorFor(input.text, input.start, input.end)
	const [row] = await tx
		.insert(aiThreads)
		.values({
			userId: input.userId,
			documentId: input.documentId,
			versionId: input.versionId,
			startOffset: selector.start,
			endOffset: selector.end,
			exact: selector.exact,
			prefix: selector.prefix,
			suffix: selector.suffix,
			action: input.action,
			highlightId: input.highlightId ?? null,
		})
		.returning()
	if (!row) throw new Error("thread insert returned nothing")
	return row
}

export interface NewMessage {
	threadId: string
	role: "user" | "assistant"
	text: string
	status?: "done" | "failed" | "refused"
	citations?: AiCitation[]
	model?: string
	inputTokens?: number
	outputTokens?: number
	cacheReadTokens?: number
}

export async function insertMessage(runner: Pick<Tx, "insert">, input: NewMessage) {
	const [row] = await runner.insert(aiMessages).values(input).returning()
	if (!row) throw new Error("message insert returned nothing")
	return row
}

export async function deleteMessage(id: string, runner: Pick<Tx, "delete"> = db) {
	await runner.delete(aiMessages).where(eq(aiMessages.id, id))
}

/** One of the user's threads, in an article in the library, unless it was deleted. */
export async function getThread(userId: string, id: string): Promise<ThreadWithMessages | null> {
	const [thread] = await db
		.select({ thread: aiThreads })
		.from(aiThreads)
		.innerJoin(documents, eq(documents.id, aiThreads.documentId))
		.where(
			and(
				eq(aiThreads.id, id),
				eq(aiThreads.userId, userId),
				isNull(aiThreads.deletedAt),
				isNull(documents.deletedAt),
			),
		)
	if (!thread) return null
	return { ...thread.thread, messages: await messagesOf([thread.thread.id]) }
}

async function messagesOf(
	threadIds: string[],
	runner: Pick<Tx, "select"> = db,
): Promise<AiMessage[]> {
	if (!threadIds.length) return []
	return runner
		.select()
		.from(aiMessages)
		.where(inArray(aiMessages.threadId, threadIds))
		.orderBy(asc(aiMessages.createdAt), asc(aiMessages.id))
}

/** Deleted, until undone (`restoreThread`). False when there was none to delete. */
export async function deleteThread(userId: string, id: string): Promise<boolean> {
	const rows = await db
		.update(aiThreads)
		.set({ deletedAt: new Date() })
		.where(and(eq(aiThreads.id, id), eq(aiThreads.userId, userId), isNull(aiThreads.deletedAt)))
		.returning({ id: aiThreads.id })
	return rows.length > 0
}

/** Undo of a delete, while the article is in the library. */
export async function restoreThread(userId: string, id: string): Promise<boolean> {
	const live = db
		.select({ id: documents.id })
		.from(documents)
		.where(and(eq(documents.userId, userId), isNull(documents.deletedAt)))
	// A cleared chat comes back only while the article has no newer one: one chat per article.
	const [gone] = await db
		.select({ action: aiThreads.action, documentId: aiThreads.documentId })
		.from(aiThreads)
		.where(and(eq(aiThreads.id, id), eq(aiThreads.userId, userId)))
	if (gone?.action === "chat" && (await getChat(userId, gone.documentId))) return false
	const rows = await db
		.update(aiThreads)
		.set({ deletedAt: null })
		.where(
			and(
				eq(aiThreads.id, id),
				eq(aiThreads.userId, userId),
				isNotNull(aiThreads.deletedAt),
				inArray(aiThreads.documentId, live),
			),
		)
		.returning({ id: aiThreads.id })
	return rows.length > 0
}

/**
 * An article's threads in reading order, with their turns. Threads made on an older version are
 * moved to the current one the way highlights are (`listDocumentHighlights`), and their answers'
 * citations with them (`movedCitations`); a passage that is gone leaves its thread orphaned, still
 * listed, with its citations as they were.
 */
export async function listDocumentThreads(
	userId: string,
	documentId: string,
	currentVersionId: string | null,
): Promise<ThreadWithMessages[]> {
	let threads = await db
		.select()
		.from(aiThreads)
		.where(
			and(
				eq(aiThreads.documentId, documentId),
				eq(aiThreads.userId, userId),
				isNull(aiThreads.deletedAt),
			),
		)
		.orderBy(asc(aiThreads.startOffset), desc(aiThreads.createdAt))
	const stale = threads.filter((t) => t.versionId !== currentVersionId)
	const version = stale.length ? await currentText(documentId, currentVersionId) : null
	if (version) {
		const moved = new Map<string, AiThread>()
		for (const t of stale) {
			// A chat has no passage: it moves to the new text as is.
			const resolved =
				t.action === "chat"
					? { start: 0, end: 0 }
					: resolveSelector(version.text, {
							exact: t.exact,
							prefix: t.prefix,
							suffix: t.suffix,
							start: t.startOffset,
							end: t.endOffset,
						})
			const set =
				resolved && !("ambiguous" in resolved)
					? (() => {
							const sel = selectorFor(version.text, resolved.start, resolved.end)
							return {
								versionId: version.id,
								startOffset: sel.start,
								endOffset: sel.end,
								exact: sel.exact,
								prefix: sel.prefix,
								suffix: sel.suffix,
								orphaned: false,
							}
						})()
					: t.orphaned
						? null
						: { orphaned: true }
			if (!set) continue
			const row = await db.transaction(async (tx) => {
				const [row] = await tx
					.update(aiThreads)
					.set(set)
					.where(and(eq(aiThreads.id, t.id), eq(aiThreads.versionId, t.versionId)))
					.returning()
				if (!row || row.versionId !== version.id) return row
				for (const m of await messagesOf([t.id], tx)) {
					const citations = movedCitations(version.text, m.citations)
					if (citations !== m.citations)
						await tx.update(aiMessages).set({ citations }).where(eq(aiMessages.id, m.id))
				}
				return row
			})
			if (row) moved.set(t.id, row)
		}
		threads = threads.map((t) => moved.get(t.id) ?? t).sort((a, b) => a.startOffset - b.startOffset)
	}
	const messages = await messagesOf(threads.map((t) => t.id))
	return threads.map((t) => ({ ...t, messages: messages.filter((m) => m.threadId === t.id) }))
}

/**
 * An answer's citations in a new version of the article: each quote where it now is, nearest to
 * where it was; one no longer in the text is dropped, so a chip never points at other words. The
 * same array when nothing moved.
 */
export function movedCitations(text: string, citations: AiCitation[]): AiCitation[] {
	if (!citations.length) return citations
	const moved = citations.flatMap((c) => {
		const range = citationRange(text, { citedText: c.exact, start: c.start, end: c.end }, c.at)
		return range ? [range] : []
	})
	const same =
		moved.length === citations.length &&
		moved.every((c, i) => c.start === citations[i]!.start && c.end === citations[i]!.end)
	return same ? citations : moved
}

/** The user's brief of an article's version, when there is one. */
export async function getBrief(userId: string, versionId: string): Promise<AiBrief | null> {
	const [row] = await db
		.select()
		.from(aiBriefs)
		.where(and(eq(aiBriefs.versionId, versionId), eq(aiBriefs.userId, userId)))
	return row ?? null
}

export type NewBrief = Omit<typeof aiBriefs.$inferInsert, "id" | "createdAt">

/** Keeps a brief; one written at the same time for the same version wins, and is returned. */
export async function insertBrief(input: NewBrief): Promise<AiBrief> {
	const [row] = await db.insert(aiBriefs).values(input).onConflictDoNothing().returning()
	if (row) return row
	const kept = await getBrief(input.userId, input.versionId)
	if (!kept) throw new Error("brief insert returned nothing")
	return kept
}

/** The article's chat: its one thread about the whole article. */
export async function getChat(
	userId: string,
	documentId: string,
	runner: Pick<Tx, "select"> = db,
): Promise<AiThread | null> {
	const [row] = await runner
		.select()
		.from(aiThreads)
		.where(
			and(
				eq(aiThreads.documentId, documentId),
				eq(aiThreads.userId, userId),
				eq(aiThreads.action, "chat"),
				isNull(aiThreads.deletedAt),
			),
		)
		.orderBy(desc(aiThreads.createdAt))
		.limit(1)
	return row ?? null
}

/** Holds the article's chat until the transaction ends: two first questions make one chat. */
export async function lockChat(tx: Tx, documentId: string) {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-chat:${documentId}`}))`)
}
