import { defineConfig } from "drizzle-kit"
import { loadEnv } from "./src/env"

loadEnv()

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema/index.ts",
	out: "./drizzle",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgres://klipstack:klipstack@localhost:5433/klipstack",
	},
	strict: true,
	verbose: true,
})
