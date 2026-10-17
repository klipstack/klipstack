import { and, db, eq, sql, user as userTable } from "@klipstack/db"
import { type StarterLanguage, starterGuide } from "~/lib/starter-texts.server"
import { saveStarterText } from "./saving.server"

/**
 * Home's welcome note is closed, for good. With `guide`, the reader asked to be shown around: the
 * guide to Klipstack is added to their library, or found there, and its article's id returned.
 */
export async function closeWelcome(
	userId: string,
	{ guide, language }: { guide: boolean; language: StarterLanguage },
): Promise<{ articleId: string | null }> {
	await db
		.update(userTable)
		.set({ prefs: sql`${userTable.prefs} || '{"welcomeCardDue": false}'::jsonb` })
		.where(
			and(eq(userTable.id, userId), sql`(${userTable.prefs}->>'welcomeCardDue')::boolean is true`),
		)
	if (!guide) return { articleId: null }
	const { articleId } = await saveStarterText(userId, starterGuide(language).slug)
	return { articleId }
}
