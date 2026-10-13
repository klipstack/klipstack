import { fallbackLanguage, isLocale } from "@klipstack/i18n"
import { env } from "./env.server"

/**
 * The branded image for link previews: the landing headline beside a highlighted passage and a
 * reader's note, one per language (scripts/icons.ts draws them). Bump `v` when they change.
 */
export function shareCard(locale: string | undefined) {
	const lang = isLocale(locale) ? locale : fallbackLanguage
	return { url: `${env.APP_URL}/icons/share-${lang}.png?v=5`, width: 1200, height: 630 }
}
