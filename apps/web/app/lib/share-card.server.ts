import { fallbackLanguage, isLocale } from "@klipstack/i18n"
import { env } from "./env.server"

/**
 * The branded image for link previews: the logo and the landing headline on the navy tile, one per language
 * (scripts/icons.ts draws them).
 */
export function shareCard(locale: string | undefined) {
	const lang = isLocale(locale) ? locale : fallbackLanguage
	return { url: `${env.APP_URL}/icons/share-${lang}.png?v=3`, width: 1200, height: 630 }
}
