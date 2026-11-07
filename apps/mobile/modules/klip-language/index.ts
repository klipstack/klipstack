import { requireOptionalNativeModule } from "expo"

/** Languages' names, as iOS writes them. Null without the module (not iOS). */
export const klipLanguage = requireOptionalNativeModule<{
	/** The name of the language `code` in `locale`'s language ("fr", "es" → "francés"); null when unknown. */
	languageName(code: string, locale: string): string | null
}>("KlipLanguage")
