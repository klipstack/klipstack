import { klipLanguage } from "../../modules/klip-language"

/**
 * `Intl.DisplayNames` for languages, which Hermes lacks: iOS names them (`modules/klip-language`).
 * Installed once at launch, so code that names a language (the reader's translation bar) does it
 * as on the web, and as in its tests. Only `type: "language"`.
 */
export function installLanguageNames(): void {
	if (typeof Intl.DisplayNames === "function" || !klipLanguage) return
	const native = klipLanguage
	class LanguageNames {
		private readonly locale: string
		constructor(locales: string | readonly string[], options: { type: string }) {
			if (options.type !== "language") throw new RangeError(`No names of type ${options.type}`)
			this.locale = (typeof locales === "string" ? locales : locales[0]) ?? "en"
		}
		of(code: string): string | undefined {
			return native.languageName(code, this.locale) ?? undefined
		}
	}
	Object.defineProperty(Intl, "DisplayNames", {
		value: LanguageNames,
		configurable: true,
		writable: true,
	})
}
