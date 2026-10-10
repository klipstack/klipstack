import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: ["app/**/*.test.ts", "app/**/*.test.tsx", "scripts/demo/**/*.test.ts"],
		environment: "node",
	},
	resolve: { tsconfigPaths: true },
})
