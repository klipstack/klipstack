import { db, eq, sql, user as userTable } from "@klipstack/db"
import { AppError } from "~/lib/app-error"
import { findNews } from "~/lib/news.server"

/**
 * A news entry is closed in the sidebar, or opened from it: it does not return there, on any
 * device. Closing it again changes nothing. An entry that is not in `app/news/` is `not_found`.
 */
export async function closeNews(
	userId: string,
	{ slug }: { slug: string },
): Promise<{ slug: string }> {
	if (!findNews(slug)) throw new AppError("not_found", "No such news.")
	const closed = sql`coalesce(${userTable.prefs}->'newsClosed', '[]'::jsonb)`
	await db
		.update(userTable)
		.set({
			prefs: sql`jsonb_set(${userTable.prefs}, '{newsClosed}', (${closed} - ${slug}::text) || to_jsonb(${slug}::text))`,
		})
		.where(eq(userTable.id, userId))
	return { slug }
}
