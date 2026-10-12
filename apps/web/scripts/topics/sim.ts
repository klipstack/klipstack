import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { config as loadDotenv } from "dotenv"
import { parseUrls } from "../demo/cache"
import { assertLocal, EMAIL } from "../demo/local"
import { type Article, type Config, DEFAULT_CONFIG, Simulation } from "./engine"
import { Models } from "./models"
import { type Comparison, PLAIN_TEMPLATE, type ReportRun, writeReport } from "./report"

const root = fileURLToPath(new URL("../../../../", import.meta.url))
loadDotenv({ path: resolve(root, ".env"), quiet: true })

const usage = `Usage: pnpm --filter @klipstack/web topics <command> [options]
  snapshot            Save the demo account's articles, oldest first, to the corpus file
  import              Fetch the pages of a list of addresses (--urls), in that order, as the corpus
  run                 Replay the corpus from an empty library, one article at a time
  compare             Sort every article into one run's final topics with both classifiers
  report              Write the report of every saved run

Options:
  --dir PATH          Corpus, model cache and runs (default: .topics-sim)
  --name NAME         run: the run's name (default: the classifier's name)
  --classifier jev|haiku
  --bootstrap N       Articles before the first topics (default ${DEFAULT_CONFIG.bootstrapSize})
  --apply P           Probability to apply a topic (default ${DEFAULT_CONFIG.applyThreshold})
  --suggest P         Probability to suggest one (default ${DEFAULT_CONFIG.suggestThreshold})
  --pool N            Unsorted articles before asking for a new topic (default ${DEFAULT_CONFIG.poolSize})
  --maintain N        A maintenance pass every N articles (default ${DEFAULT_CONFIG.maintainEvery})
  --style broad|specific|sections  How topics are named (default broad)
  --question main|shelf  What Jev is asked about each topic (default main)
  --widen             Let unsorted articles widen an existing topic's description
  --sample N          Ask Haiku again instead of reusing its cached answers (default 0)
  --reader            A simulated reader corrects the topics; the run ends with its audit
  --taste lenient|strict  How picky the reader is (default lenient)
  --attention P       The share of articles the reader looks at (default ${DEFAULT_CONFIG.attention})
  --reader-every N    The reader looks after every N articles (default ${DEFAULT_CONFIG.readerEvery})
  --limit N           run: only the first N articles
  --run NAME          compare: the run whose final topics both classifiers use (default: jev)
  --out PATH          report: the HTML file (default: <dir>/report.html)
  --featured A,B      report: the runs shown in full (default: all)
  --template PATH     report: the page template (default: <dir>/page-template.html, else plain)
  --notes PATH        report: the hand-written header and findings (default: <dir>/notes.html)
`

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			dir: { type: "string", default: ".topics-sim" },
			name: { type: "string" },
			classifier: { type: "string" },
			bootstrap: { type: "string" },
			apply: { type: "string" },
			suggest: { type: "string" },
			pool: { type: "string" },
			maintain: { type: "string" },
			limit: { type: "string" },
			run: { type: "string", default: "jev" },
			style: { type: "string" },
			sample: { type: "string" },
			widen: { type: "boolean" },
			reader: { type: "boolean" },
			attention: { type: "string" },
			taste: { type: "string" },
			"reader-every": { type: "string" },
			question: { type: "string" },
			featured: { type: "string" },
			urls: { type: "string" },
			out: { type: "string" },
			template: { type: "string" },
			notes: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	})
	const command = positionals[0]
	if (values.help || !["snapshot", "import", "run", "compare", "report"].includes(command ?? "")) {
		console.log(usage)
		return
	}
	const dir = resolve(root, values.dir)
	const corpusFile = resolve(dir, "corpus.json")

	if (command === "snapshot") {
		assertLocal(process.env)
		const articles = await loadArticles()
		await mkdir(dir, { recursive: true })
		await writeFile(corpusFile, JSON.stringify(articles, null, "\t"))
		console.log(`Saved ${articles.length} articles to ${corpusFile}`)
		process.exit(0)
	}

	if (command === "import") {
		if (!values.urls) throw new Error("import: --urls PATH, one address per line, oldest first")
		const urls = parseUrls(await readFile(resolve(root, values.urls), "utf8"))
		const { articles, failed } = await importUrls(urls)
		for (const f of failed) console.log(`  failed: ${f.url}: ${f.error}`)
		// Nothing read: the corpus there stays as it was, and with it the runs made from it.
		if (articles.length === 0) throw new Error("import: no page could be read; nothing written")
		await mkdir(dir, { recursive: true })
		await writeFile(corpusFile, JSON.stringify(articles, null, "\t"))
		await writeFile(resolve(dir, "import-failures.json"), JSON.stringify(failed, null, "\t"))
		console.log(`Saved ${articles.length} of ${urls.length} articles to ${corpusFile}`)
		return
	}

	const corpus = JSON.parse(await readFile(corpusFile, "utf8")) as Article[]

	const models = new Models(resolve(dir, "cache"), {
		anthropic: process.env.ANTHROPIC_API_KEY,
		typesafe: process.env.TYPESAFE_API_KEY,
	})

	if (command === "compare") {
		const run = JSON.parse(
			await readFile(resolve(dir, "runs", `${values.run}.json`), "utf8"),
		) as ReportRun
		const topics = run.topics.filter((t) => t.retiredAt === undefined)
		const scores: Comparison["scores"] = { jev: {}, haiku: {} }
		for (const classifier of ["jev", "haiku"] as const) {
			// The run's own settings (question, text length), with the other classifier.
			const sim = new Simulation({ ...DEFAULT_CONFIG, ...run.config, classifier }, models)
			for (let i = 0; i < corpus.length; i += 8)
				await Promise.all(
					corpus.slice(i, i + 8).map(async (article) => {
						scores[classifier][article.id] = await sim.score(article, topics)
					}),
				)
		}
		const comparison: Comparison = { run: run.name, topics, scores, calls: models.calls }
		await writeFile(resolve(dir, "compare.json"), JSON.stringify(comparison, null, "\t"))
		console.log(`Compared ${corpus.length} articles in ${topics.length} topics of ${run.name}`)
		return
	}

	if (command === "report") {
		const comparison = await readFile(resolve(dir, "compare.json"), "utf8")
			.then((text) => JSON.parse(text) as Comparison)
			.catch(() => undefined)
		const all: ReportRun[] = []
		for (const file of (await readdir(resolve(dir, "runs")).catch(() => [] as string[])).sort())
			if (file.endsWith(".json"))
				all.push(JSON.parse(await readFile(resolve(dir, "runs", file), "utf8")))
		const featured = values.featured?.split(",") ?? all.map((r) => r.name)
		const runs = featured.map((name) => {
			const run = all.find((r) => r.name === name)
			if (!run) throw new Error(`No run named ${name}`)
			return run
		})
		const out = values.out ? resolve(root, values.out) : resolve(dir, "report.html")
		await mkdir(dirname(out), { recursive: true })
		const template = await readFile(
			values.template ?? resolve(dir, "page-template.html"),
			"utf8",
		).catch(() => PLAIN_TEMPLATE)
		const notes = await readFile(values.notes ?? resolve(dir, "notes.html"), "utf8").catch(() => "")
		await writeFile(
			out,
			writeReport(corpus, runs, {
				template,
				notes,
				comparison,
				all,
				title: "Automatic topics: the simulation",
			}),
		)
		console.log(`Wrote ${out} with ${runs.length} runs`)
		return
	}

	const config: Config = {
		...DEFAULT_CONFIG,
		classifier: oneOf("classifier", values.classifier, ["jev", "haiku"], DEFAULT_CONFIG.classifier),
		bootstrapSize: count("bootstrap", values.bootstrap, DEFAULT_CONFIG.bootstrapSize),
		applyThreshold: probability("apply", values.apply, DEFAULT_CONFIG.applyThreshold),
		suggestThreshold: probability("suggest", values.suggest, DEFAULT_CONFIG.suggestThreshold),
		poolSize: count("pool", values.pool, DEFAULT_CONFIG.poolSize),
		maintainEvery: count("maintain", values.maintain, DEFAULT_CONFIG.maintainEvery),
		style: oneOf("style", values.style, ["broad", "specific", "sections"], DEFAULT_CONFIG.style),
		sample: count("sample", values.sample, 0, 0),
		widen: values.widen ?? false,
		question: oneOf("question", values.question, ["main", "shelf"], DEFAULT_CONFIG.question),
		reader: values.reader ?? false,
		taste: oneOf("taste", values.taste, ["lenient", "strict"], DEFAULT_CONFIG.taste),
		attention: probability("attention", values.attention, DEFAULT_CONFIG.attention),
		readerEvery: count("reader-every", values["reader-every"], DEFAULT_CONFIG.readerEvery),
	}
	const name = values.name ?? config.classifier
	// The name becomes a file name in the runs directory.
	if (!/^[\w.-]+$/.test(name)) throw new Error(`--name: letters, digits, ".", "-" and "_" only`)
	const sim = new Simulation(config, models, (line) => console.log(line))
	const articles = corpus.slice(0, count("limit", values.limit, corpus.length))
	for (const article of articles) await sim.arrive(article)
	const audit = config.reader ? await sim.audit() : undefined
	const saved: ReportRun = { ...sim.result(name), audit, calls: models.calls }
	await mkdir(resolve(dir, "runs"), { recursive: true })
	await writeFile(resolve(dir, "runs", `${name}.json`), JSON.stringify(saved, null, "\t"))
	const cost = models.calls.reduce((sum, c) => sum + c.cost, 0)
	const fresh = models.calls.filter((c) => !c.cached).length
	console.log(
		`\n${name}: ${sim.topics.filter((t) => t.retiredAt === undefined).length} topics, ${models.calls.length} calls (${fresh} new), $${cost.toFixed(4)}`,
	)
	if (audit)
		console.log(
			`audit: ${audit.agreed}/${audit.applied} placements the reader agrees with, ${audit.found}/${audit.wanted} of theirs found; ${sim.refusals.filter((r) => !r.carried).length} taken out`,
		)
}

/**
 * Each address fetched as the app saves it: a post on X through FxTwitter, any other page with
 * the extractors. A page that can't be read is left out and listed. Four at a time, in order.
 */
async function importUrls(urls: string[]) {
	const { extractArticle, extractXPost, fetchPage, fetchXPost } = await import("@klipstack/extract")
	const read = async (url: string, at: number): Promise<Article> => {
		const host = new URL(url).hostname.replace(/^www\./, "")
		const article =
			host === "x.com" || host === "twitter.com"
				? extractXPost((await fetchXPost(url)).json, url)
				: await (async () => {
						const page = await fetchPage(url, { timeoutMs: 20_000 })
						return extractArticle({ html: page.html, url: page.finalUrl })
					})()
		if (!article.text.trim()) throw new Error("no text")
		const digest = createHash("sha256").update(url).digest("hex")
		return {
			// A stable id from the address: reruns keep their cached answers.
			id: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`,
			title: article.title,
			siteName: article.siteName,
			description: article.description,
			savedAt: new Date(Date.UTC(2026, 0, 1) + at * 60_000).toISOString(),
			text: article.text,
			manualTags: [],
		}
	}
	const results: (Article | { url: string; error: string })[] = Array.from({ length: urls.length })
	let next = 0
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			while (next < urls.length) {
				const at = next++
				const url = urls[at]!
				try {
					results[at] = await read(url, at)
				} catch (error) {
					results[at] = { url, error: error instanceof Error ? error.message : String(error) }
				}
			}
		}),
	)
	return {
		articles: results.filter((r): r is Article => "text" in r),
		failed: results.filter((r): r is { url: string; error: string } => "error" in r),
	}
}

/** The demo account's articles with their text, oldest first: the order they were saved in. */
async function loadArticles(): Promise<Article[]> {
	const { and, asc, db, documents, documentTags, documentVersions, eq, isNull, tags, user } =
		await import("@klipstack/db")
	const rows = await db
		.select({
			id: documents.id,
			title: documents.title,
			siteName: documents.siteName,
			description: documents.description,
			savedAt: documents.createdAt,
			text: documentVersions.text,
		})
		.from(documents)
		.innerJoin(user, eq(user.id, documents.userId))
		.innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
		.where(and(eq(user.email, EMAIL), isNull(documents.deletedAt)))
		.orderBy(asc(documents.createdAt), asc(documents.id))
	const tagRows = await db
		.select({ documentId: documentTags.documentId, name: tags.name })
		.from(documentTags)
		.innerJoin(tags, eq(tags.id, documentTags.tagId))
		.innerJoin(user, eq(user.id, tags.userId))
		.where(eq(user.email, EMAIL))
	return rows.map((r) => ({
		id: r.id,
		title: r.title ?? "(untitled)",
		siteName: r.siteName,
		description: r.description,
		savedAt: r.savedAt.toISOString(),
		text: r.text,
		manualTags: tagRows.filter((t) => t.documentId === r.id).map((t) => t.name),
	}))
}

/** A whole number of at least `min`, or the fallback when the option is absent. */
function count(option: string, value: string | undefined, fallback: number, min = 1): number {
	if (value === undefined) return fallback
	const n = Number(value)
	if (!Number.isInteger(n) || n < min) throw new Error(`--${option}: a whole number from ${min}`)
	return n
}

function probability(option: string, value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback
	const p = Number(value)
	if (!(p > 0 && p <= 1)) throw new Error(`--${option}: a number above 0, at most 1`)
	return p
}

function oneOf<T extends string>(
	option: string,
	value: string | undefined,
	allowed: readonly T[],
	fallback: T,
): T {
	if (value === undefined) return fallback
	if (!allowed.includes(value as T)) throw new Error(`--${option}: one of ${allowed.join(", ")}`)
	return value as T
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
