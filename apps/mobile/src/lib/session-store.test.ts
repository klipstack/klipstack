import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")
const secureStore = dirname(
	createRequire(import.meta.url).resolve("expo-secure-store/package.json"),
)

/**
 * The share extension reads the session item with its own keychain query, copied from
 * expo-secure-store's layout. An upgrade that changes the layout would leave the extension saying
 * "Sign in" with no error: these checks fail first.
 */
describe("the share extension's keychain query", () => {
	it("matches the item expo-secure-store writes for the app", () => {
		const store = read("session-store.ts")
		expect(store).toContain('keychainService: "klipstack"')
		expect(store).toContain('const KEY = "session"')
		expect(store).toContain('export const APP_GROUP = "group.com.klipstack.app"')
		// The app never asks for authentication, so expo appends ":no-auth" to the service.
		expect(store).not.toContain("requireAuthentication")

		const expo = readFileSync(join(secureStore, "ios/SecureStoreModule.swift"), "utf8")
		expect(expo).toContain('service.append(":\\(requireAuthentication ? "auth" : "no-auth")")')
		expect(expo).toContain("kSecAttrGeneric as String: encodedKey")
		expect(expo).toContain("kSecAttrAccount as String: encodedKey")

		const share = read("../../targets/share/ShareViewController.swift")
		expect(share).toContain('kSecAttrService as String: "klipstack:no-auth"')
		expect(share).toContain('let key = Data("session".utf8)')
		expect(share).toContain("kSecAttrGeneric as String: key")
		expect(share).toContain("kSecAttrAccount as String: key")
		expect(share).toContain('kSecAttrAccessGroup as String: "group.com.klipstack.app"')
	})
})
