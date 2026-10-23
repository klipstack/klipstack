import { KlipstackApiError } from "@klipstack/sdk"
import { afterEach, describe, expect, it, vi } from "vitest"

/** The app's i18n as on a phone whose languages are `tags`, in the person's order. */
async function onPhone(...tags: string[]) {
	vi.resetModules()
	vi.doMock("expo-localization", () => ({
		getLocales: () => tags.map((tag) => ({ languageTag: tag, languageCode: tag.split("-")[0] })),
	}))
	return import("./i18n")
}

afterEach(() => {
	vi.doUnmock("expo-localization")
})

describe("the app's language", () => {
	it("is the first of the phone's languages the app speaks", async () => {
		const i18n = await onPhone("fr-FR", "es-CL", "en-US")
		expect(i18n.language).toBe("es")
		expect(i18n.t("common.tabs.library")).toBe("Biblioteca")
		expect(i18n.dateLocale).toBe("es-CL")
	})

	it("is English when the phone has none the app speaks", async () => {
		const i18n = await onPhone("fr-FR", "de-DE")
		expect(i18n.language).toBe("en")
		expect(i18n.t("common.tabs.library")).toBe("Library")
		expect(i18n.dateLocale).toBe("en-US")
	})
})

describe("errorMessage", () => {
	it("in English, is the error's own message", async () => {
		const { errorMessage } = await onPhone("en-GB")
		expect(errorMessage(new TypeError("Network request failed"))).toBe("Network request failed")
		expect(errorMessage(new KlipstackApiError(429, "rate_limited", "Slow down."))).toBe(
			"Slow down.",
		)
	})

	it("in Spanish, says the failures that need no detail in Spanish and keeps the rest", async () => {
		const { errorMessage } = await onPhone("es-ES")
		expect(errorMessage(new TypeError("Network request failed"))).toBe(
			"No se puede conectar con Klipstack. Revisa tu conexión.",
		)
		expect(errorMessage(new KlipstackApiError(429, "rate_limited", "Slow down."))).toBe(
			"Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
		)
		expect(
			errorMessage(new KlipstackApiError(400, "invalid_request", "A tag has 1 to 64 characters.")),
		).toBe("A tag has 1 to 64 characters.")
	})
})
