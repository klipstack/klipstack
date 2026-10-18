import {
	and,
	db,
	desc,
	documents,
	eq,
	gte,
	highlights,
	inArray,
	isNull,
	lte,
	or,
	readingCompletions,
	type Db,
	type SQL,
	sql,
	type Tx,
	user as userTable,
} from "@klipstack/db"
import { NOTE_REMINDERS } from "~/lib/note-reminders"

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

/**
 * Articles the reader finished lately without a note on them: read to the end, finished from the
 * reader, or listened to, in the last `NOTE_REMINDERS.withinDays`. Only the latest reading counts
 * (an article read again is asked about again once it is finished again). Left out: finishes that
 * were tidying up (several at once, or one finished from a list without being opened first),
 * articles in the trash, and those marked "Nothing to add" (`noteSkippedAt`). Highlight notes don't
 * count: they are about a passage, the note about the whole.
 */
function reminderWhere(userId: string, now: Date): SQL {
	const since = new Date(now.getTime() - NOTE_REMINDERS.withinDays * DAY_MS)
	const settled = new Date(now.getTime() - NOTE_REMINDERS.graceMinutes * MINUTE_MS)
	return and(
		eq(readingCompletions.userId, userId),
		eq(documents.userId, userId),
		isNull(documents.deletedAt),
		eq(documents.status, "ready"),
		eq(readingCompletions.cycle, documents.readingCycle),
		gte(readingCompletions.completedAt, since),
		or(
			eq(readingCompletions.source, "listened"),
			and(
				inArray(readingCompletions.source, ["progress", "manual"]),
				lte(readingCompletions.completedAt, settled),
			),
		),
		// Finishing opens an article never opened: opened then, it was finished from a list.
		sql`(${readingCompletions.source} <> 'manual' or ${documents.firstOpenedAt} < ${readingCompletions.completedAt} - interval '1 minute')`,
		sql`coalesce(${documents.note}, '') = ''`,
		isNull(documents.noteSkippedAt),
	) as SQL
}

export interface NoteReminder {
	id: string
	title: string | null
	siteName: string | null
	author: string | null
	sourceUrl: string
	finishedAt: Date
	listened: boolean
	/** A few of its highlights, in the article's order, to bring it back to mind. */
	highlights: { id: string; quote: string; color: number }[]
}

/** Highlights shown with each article. */
const HIGHLIGHTS_SHOWN = 3

/**
 * The articles to ask about, the latest finished first (`limit` of them), how many there are in
 * all, and whether Home asks: at least `NOTE_REMINDERS.minToSuggest`, or any listened to, and the
 * card not put off (`snoozeNoteReminders`).
 */
export async function listNoteReminders(
	userId: string,
	{ now = new Date(), limit = NOTE_REMINDERS.shown }: { now?: Date; limit?: number } = {},
): Promise<{ items: NoteReminder[]; total: number; suggested: boolean }> {
	const where = reminderWhere(userId, now)
	const [rows, [count], [prefs]] = await Promise.all([
		db
			.select({
				id: documents.id,
				title: documents.title,
				siteName: documents.siteName,
				author: documents.author,
				sourceUrl: documents.sourceUrl,
				finishedAt: readingCompletions.completedAt,
				source: readingCompletions.source,
			})
			.from(readingCompletions)
			.innerJoin(documents, eq(documents.id, readingCompletions.documentId))
			.where(where)
			.orderBy(desc(readingCompletions.completedAt), desc(documents.id))
			.limit(limit),
		db
			.select({
				total: sql<number>`count(*)::int`,
				listened: sql<number>`count(*) filter (where ${readingCompletions.source} = 'listened')::int`,
			})
			.from(readingCompletions)
			.innerJoin(documents, eq(documents.id, readingCompletions.documentId))
			.where(where),
		db
			.select({ after: sql<string | null>`${userTable.prefs}->>'noteRemindersAfter'` })
			.from(userTable)
			.where(eq(userTable.id, userId)),
	])
	const quotes = rows.length
		? await db
				.select({
					id: highlights.id,
					documentId: highlights.documentId,
					quote: highlights.exact,
					color: highlights.color,
				})
				.from(highlights)
				.where(
					and(
						inArray(
							highlights.documentId,
							rows.map((r) => r.id),
						),
						eq(highlights.userId, userId),
						isNull(highlights.deletedAt),
					),
				)
				.orderBy(highlights.documentId, highlights.startOffset, highlights.id)
		: []
	const total = count?.total ?? 0
	const snoozed = prefs?.after ? new Date(prefs.after) > now : false
	return {
		items: rows.map(({ source, ...row }) => ({
			...row,
			listened: source === "listened",
			highlights: quotes
				.filter((h) => h.documentId === row.id)
				.slice(0, HIGHLIGHTS_SHOWN)
				.map((h) => ({ id: h.id, quote: h.quote, color: h.color })),
		})),
		total,
		suggested: !snoozed && (total >= NOTE_REMINDERS.minToSuggest || (count?.listened ?? 0) > 0),
	}
}

/** "Nothing to add" on the user's article, or taking it back. The id when it is theirs and live. */
export async function setNoteSkipped(
	tx: Db | Tx,
	userId: string,
	id: string,
	skipped: boolean,
): Promise<string | null> {
	const [row] = await tx
		.update(documents)
		.set({ noteSkippedAt: skipped ? sql`coalesce(${documents.noteSkippedAt}, now())` : null })
		.where(and(eq(documents.userId, userId), eq(documents.id, id), isNull(documents.deletedAt)))
		.returning({ id: documents.id })
	return row?.id ?? null
}

/** No card for notes on Home for `NOTE_REMINDERS.snoozeDays`. */
export async function snoozeNoteReminders(userId: string, now = new Date()): Promise<void> {
	const after = new Date(now.getTime() + NOTE_REMINDERS.snoozeDays * DAY_MS).toISOString()
	await db
		.update(userTable)
		.set({
			prefs: sql`${userTable.prefs} || jsonb_build_object('noteRemindersAfter', ${after}::text)`,
		})
		.where(eq(userTable.id, userId))
}
