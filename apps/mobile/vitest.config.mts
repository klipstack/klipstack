import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			// A native module: the tests run as on a phone in English.
			"expo-localization": fileURLToPath(new URL("./test/expo-localization.ts", import.meta.url)),
		},
	},
})
