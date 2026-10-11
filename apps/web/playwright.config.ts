import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.E2E_PORT ?? 5180)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

// CI (or E2E_PROD=1) tests the production build: the dev server compiles routes on first hit and
// makes a slow runner miss timeouts. Needs `pnpm build` first.
const prod = !!process.env.CI || !!process.env.E2E_PROD
const serverCommand = prod
	? `PORT=${PORT} NODE_ENV=production APP_URL=${baseURL} node server.js & ` +
		"(cd ../worker && NODE_ENV=production pnpm start) & wait"
	: "pnpm -w dev"

/**
 * What runs in WebKit as well as Chromium (Firefox is not tested): what depends on the browser
 * engine. Selections and handles, how an input lays out its text, and editions (dates formatted in
 * the browser must match the server's, or hydration fails).
 */
const ENGINE_SPECS = ["highlight-resizing.spec.ts", "search-field.spec.ts", "editions.spec.ts"]

export default defineConfig({
	testDir: "./e2e",
	// Removes what the tests put in the local database: see e2e/cleanup.ts.
	globalSetup: "./e2e/global-setup.ts",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
	timeout: 30_000,
	use: { baseURL, trace: "retain-on-failure" },
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{
			name: "webkit-resize",
			testMatch: ENGINE_SPECS,
			use: { ...devices["Desktop Safari"] },
		},
	],
	webServer: {
		command: serverCommand,
		env: {
			RESEND_API_KEY: "re_e2e",
			// Invite-only, with the public request form (wait-list.spec.ts).
			SIGNUP_MODE: "waitlist",
			// The production build skips the API's response checks; the tests want them.
			API_CHECK_RESPONSES: "1",
			// Shows the GitHub button. The tests stop at GitHub's door: no request reaches it.
			GITHUB_CLIENT_ID: "e2e-client",
			GITHUB_CLIENT_SECRET: "e2e-secret",
			// AI answers come from a fixed fake model: no provider is called.
			AI_FAKE: "1",
			// The cap ai-reader.spec.ts counts down from, whatever the local `.env` says.
			LIMIT_AI_PER_MONTH: "100",
			NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fileURLToPath(new URL("./e2e/email-transport.mjs", import.meta.url))}`,
		},
		url: `${baseURL}/healthcheck`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		stdout: "ignore",
		stderr: "pipe",
	},
})
