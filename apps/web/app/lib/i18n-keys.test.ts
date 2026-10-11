import { fallbackLanguage, namespaces, resources } from "@klipstack/i18n"
import { createInstance } from "i18next"
import { describe, expect, it } from "vitest"
import { isNsKey } from "./i18n-keys"

async function strings(lng: string, loaded: Partial<typeof resources> = resources) {
	const i18n = createInstance()
	await i18n.init({ lng, fallbackLng: fallbackLanguage, ns: namespaces, resources: loaded })
	return i18n
}

describe("isNsKey", () => {
	it("accepts a key with its namespace", async () => {
		const i18n = await strings("en")
		expect(isNsKey(i18n, "auth:login.invalid")).toBe(true)
		expect(isNsKey(i18n, "common:nav.settings")).toBe(true)
	})
	it("accepts a key whose last part has dots, as audit actions do", async () => {
		const i18n = await strings("en")
		expect(isNsKey(i18n, "admin:audit.actions.invite.create")).toBe(true)
		expect(isNsKey(i18n, "admin:audit.actions.no.such.action")).toBe(false)
	})
	it("knows a Spanish reader's keys when the English strings failed to load", async () => {
		expect(isNsKey(await strings("es", { es: resources.es }), "auth:login.invalid")).toBe(true)
	})
	it("refuses plain text, a missing key, a group and an unknown namespace", async () => {
		const i18n = await strings("en")
		for (const value of [
			"Invalid email",
			"auth:login.nope",
			"auth:login",
			"nope:login.invalid",
			"auth:",
			"auth:constructor",
			"constructor:name",
			"toString:name",
			"admin:audit.actions.toString",
		])
			expect(isNsKey(i18n, value), value).toBe(false)
	})
})
