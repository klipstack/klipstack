import { db, sql } from "@klipstack/db"
import { fallbackLanguage } from "@klipstack/i18n/languages"
import { isStarterLanguage } from "~/lib/starter-shelves"
import { starterGuide } from "~/lib/starter-texts.server"
import { onboardingField, setOnboarding } from "~/services/onboarding.server"
import { saveStarterText } from "./saving.server"

/**
 * Home's welcome note is closed, for good. With `guide`, the reader asked to be shown around: the
 * guide to Klipstack is added to their library, or found there, in their language (`locale`, the
 * account's; English when there is no guide in it), and its article's id returned.
 */
export async function closeWelcome(
	userId: string,
	{ guide, locale }: { guide: boolean; locale: unknown },
): Promise<{ articleId: string | null }> {
	const language = isStarterLanguage(locale) ? locale : fallbackLanguage
	// The guide first: when its save is refused (a limit), the note stays, to try again.
	const articleId = guide
		? (await saveStarterText(userId, starterGuide(language).slug)).articleId
		: null
	await setOnboarding(
		db,
		userId,
		{ note: new Date().toISOString() },
		{ when: sql`${onboardingField("note")} = 'due'` },
	)
	return { articleId }
}

/** The sidebar's Getting started card is over, for good: closed, or seen with every step done. */
export async function endGettingStarted(userId: string): Promise<void> {
	await setOnboarding(
		db,
		userId,
		{ cardEndedAt: new Date().toISOString() },
		{ when: sql`${onboardingField("cardEndedAt")} is null` },
	)
}
