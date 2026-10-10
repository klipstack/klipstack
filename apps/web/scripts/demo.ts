import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { config } from "dotenv"
import { captureUrl, getBlob, loadCapture, parseUrls, writeJson } from "./demo/cache"
import { captureFeed, loadFeedCapture, prepareFeeds } from "./demo/feed-cache"
import { assertLocal, checkDate } from "./demo/local"

const root = fileURLToPath(new URL("../../../", import.meta.url))
config({ path: resolve(root, ".env"), quiet: true })
const usage = `Usage: pnpm demo:capture|demo:capture-feeds|demo:seed|demo:reset|demo:verify|demo:login-link [options]
  --urls PATH       URL list, relative to repo root (default: apps/web/scripts/demo/reader-urls.txt)
  --feeds PATH      Feed URL list (default: apps/web/scripts/demo/feed-urls.txt)
  --cache PATH      Local corpus and ownership records (default: .demo.local)
  --profile reader  The reader profile (default)
  --seed TEXT       Repeatable history (default: klipstack-reader-v1)
  --date YYYY-MM-DD  Base date; saved on first seed and reused on reset
  --refresh         Capture: refetch successful pages and images too
  --limit N         Capture: process only the first N URLs
  --dry-run         Show intended scope without changing files or database
  --url URL         Login link: the app's address (default: APP_URL)
`
async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			urls: { type: "string", default: "apps/web/scripts/demo/reader-urls.txt" },
			feeds: { type: "string", default: "apps/web/scripts/demo/feed-urls.txt" },
			cache: { type: "string", default: ".demo.local" },
			profile: { type: "string", default: "reader" },
			seed: { type: "string" },
			date: { type: "string" },
			refresh: { type: "boolean" },
			limit: { type: "string" },
			url: { type: "string" },
			"dry-run": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	})
	if (values.help) {
		console.log(usage)
		return
	}
	const command = positionals[0]
	if (
		positionals.length !== 1 ||
		!["capture", "capture-feeds", "seed", "reset", "verify", "login-link"].includes(command ?? "")
	)
		throw new Error(usage)
	if (values.profile !== "reader") throw new Error("Only --profile reader is supported")
	if (
		["capture", "capture-feeds", "verify", "login-link"].includes(command ?? "") &&
		(values.date || values.seed)
	)
		throw new Error("--date and --seed apply only to seed and reset")
	if (values.date) checkDate(values.date)
	if (values.seed !== undefined && !values.seed.trim()) throw new Error("--seed must not be blank")
	if (!command?.startsWith("capture") && (values.refresh || values.limit))
		throw new Error("--refresh and --limit apply only to capture commands")
	if (command !== "login-link" && values.url) throw new Error("--url applies only to login-link")
	const cache = resolve(root, values.cache)
	if (command === "login-link") {
		const database = assertLocal(process.env)
		const storage = resolve(root, process.env.STORAGE_FS_ROOT ?? "./storage")
		const baseUrl = new URL(values.url ?? process.env.APP_URL ?? "http://localhost:5180").href
		if (values["dry-run"]) {
			console.log(`Create a one-time sign-in link at ${baseUrl}`)
			return
		}
		const { createLoginLink } = await import("./demo/login-link")
		const { pool } = await import("@klipstack/db")
		try {
			console.log(await createLoginLink({ cache, database, storage, baseUrl }))
		} finally {
			await pool.end()
		}
		return
	}
	const feedUrls =
		command === "verify" || command === "capture"
			? []
			: parseUrls(await readFile(resolve(root, values.feeds), "utf8"))
	if (command === "capture-feeds") {
		const limit = values.limit === undefined ? feedUrls.length : Number(values.limit)
		if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer")
		const selected = feedUrls.slice(0, limit)
		if (values["dry-run"]) {
			console.log(`Capture ${selected.length} feeds and one saved article per feed into ${cache}`)
			return
		}
		let failed = 0
		for (const url of selected) {
			try {
				if (!values.refresh && (await loadFeedCapture(cache, url))) await prepareFeeds(cache, [url])
				else await captureFeed(cache, url)
				console.log(`Feed available: ${url}`)
			} catch (error) {
				failed++
				console.error(`Feed failed: ${url}: ${error instanceof Error ? error.message : error}`)
			}
		}
		if (failed) process.exitCode = 1
		return
	}
	const urls =
		command === "verify" ? [] : parseUrls(await readFile(resolve(root, values.urls), "utf8"))
	if (command !== "verify" && !urls.length) throw new Error("URL list is empty")
	if (command === "capture") {
		const limit = values.limit === undefined ? urls.length : Number(values.limit)
		if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer")
		const selected = urls.slice(0, limit)
		if (values["dry-run"]) {
			console.log(
				`Capture up to ${selected.length} URLs into ${cache}; refresh=${Boolean(values.refresh)}`,
			)
			return
		}
		const report: Array<{
			url: string
			status: string
			title?: string
			words?: number
			missingImages?: number
			error?: string
		}> = []
		for (const [i, url] of selected.entries()) {
			try {
				let capture = values.refresh ? null : await loadCapture(cache, url)
				const cached = Boolean(capture)
				if (capture) {
					await getBlob(cache, capture.page)
					for (const image of Object.values(capture.images))
						if (!("error" in image)) await getBlob(cache, image)
				} else capture = await captureUrl(cache, url)
				const missingImages = Object.values(capture!.images).filter(
					(image) => "error" in image,
				).length
				report.push({
					url,
					status: cached ? "cached" : "captured",
					title: capture!.title,
					words: capture!.words,
					missingImages,
				})
				console.log(
					`[${i + 1}/${selected.length}] ${cached ? "cached" : "captured"} ${capture!.title} (${capture!.words} words; ${missingImages} missing images)`,
				)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				report.push({ url, status: "failed", error: message })
				console.log(`[${i + 1}/${selected.length}] failed ${url}: ${message}`)
			}
			await writeJson(resolve(cache, "capture-report.json"), report)
		}
		const failed = report.filter((row) => row.status === "failed").length
		console.log(
			`${report.length - failed} available, ${failed} failed. Report: ${resolve(cache, "capture-report.json")}`,
		)
		if (failed) process.exitCode = 1
		return
	}
	const database = assertLocal(process.env)
	const storage = resolve(root, process.env.STORAGE_FS_ROOT ?? "./storage")
	// Import after the local-only guard: application modules may query at module initialization.
	const { runDemo } = await import("./demo/account")
	const { pool } = await import("@klipstack/db")
	try {
		await runDemo({
			command: command as "seed" | "reset" | "verify",
			cache,
			database,
			storage,
			urls,
			feedUrls,
			seed: values.seed,
			date: values.date,
			dryRun: Boolean(values["dry-run"]),
		})
	} finally {
		await pool.end()
	}
}
try {
	await main()
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
}
