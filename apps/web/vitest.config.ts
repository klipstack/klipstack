import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: [
			"app/**/*.test.ts",
			"app/**/*.test.tsx",
			"scripts/demo/**/*.test.ts",
			"scripts/topics/**/*.test.ts",
		],
		environment: "node",
		// Changes the dev server (app/dev-dependencies.test.ts), which no test imports.
		forceRerunTriggers: [...configDefaults.forceRerunTriggers, "**/react-router.config.ts"],
	},
	resolve: { tsconfigPaths: true },
})
