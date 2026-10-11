import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { config as loadDotenv } from "dotenv"
import { assertLocal, EMAIL } from "../demo/local"
import { type Article, type Config, DEFAULT_CONFIG, Simulation } from "./engine"
import { Models } from "./models"
import { type Comparison, PLAIN_TEMPLATE, type ReportRun, writeReport } from "./report"

const root = fileURLToPath(new URL("../../../../", import.meta.url))
loadDotenv({ path: resolve(root, ".env"), quiet: true })

const usage = `Usage: pnpm --filter @klipstack/web topics <command> [options]
  snapshot            Save the demo account's articles, oldest first, to the corpus file
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
  --style broad|specific  How topics are named (default broad)
  --question main|shelf  What Jev is asked about each topic (default main)
  --widen             Let unsorted articles widen an existing topic's description
  --sample N          Ask Haiku again instead of reusing its cached answers (default 0)
  --limit N           run: only the first N articles
  --run NAME          compare: the run whose final topics both classifiers use (default: jev)
  --out PATH          report: the HTML file (default: .amp/in/artifacts/pages/auto-topics.html)
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
			question: { type: "string" },
			featured: { type: "string" },
			out: { type: "string", default: ".amp/in/artifacts/pages/auto-topics.html" },
			template: { type: "string" },
			notes: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	})
	const command = positionals[0]
	if (values.help || !["snapshot", "run", "compare", "report"].includes(command ?? "")) {
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
			const sim = new Simulation({ ...DEFAULT_CONFIG, classifier }, models)
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
		for (const sub of ["runs-v1", "runs"])
			for (const file of (await readdir(resolve(dir, sub)).catch(() => [] as string[])).sort())
				if (file.endsWith(".json"))
					all.push(JSON.parse(await readFile(resolve(dir, sub, file), "utf8")))
		const featured = values.featured?.split(",") ?? all.map((r) => r.name)
		const runs = featured.map((name) => {
			const run = all.find((r) => r.name === name)
			if (!run) throw new Error(`No run named ${name}`)
			return run
		})
		const out = resolve(root, values.out)
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

	const classifier = values.classifier ?? DEFAULT_CONFIG.classifier
	if (classifier !== "jev" && classifier !== "haiku") throw new Error(usage)
	const number = (value: string | undefined, fallback: number) =>
		value === undefined ? fallback : Number(value)
	const config: Config = {
		...DEFAULT_CONFIG,
		classifier,
		bootstrapSize: number(values.bootstrap, DEFAULT_CONFIG.bootstrapSize),
		applyThreshold: number(values.apply, DEFAULT_CONFIG.applyThreshold),
		suggestThreshold: number(values.suggest, DEFAULT_CONFIG.suggestThreshold),
		poolSize: number(values.pool, DEFAULT_CONFIG.poolSize),
		maintainEvery: number(values.maintain, DEFAULT_CONFIG.maintainEvery),
		style: values.style === "specific" ? "specific" : "broad",
		sample: number(values.sample, 0),
		widen: values.widen ?? false,
		question: values.question === "shelf" ? "shelf" : "main",
	}
	const name = values.name ?? classifier
	const sim = new Simulation(config, models, (line) => console.log(line))
	const articles = corpus.slice(0, number(values.limit, corpus.length))
	for (const article of articles) await sim.arrive(article)
	const saved: ReportRun = { ...sim.result(name), calls: models.calls }
	await mkdir(resolve(dir, "runs"), { recursive: true })
	await writeFile(resolve(dir, "runs", `${name}.json`), JSON.stringify(saved, null, "\t"))
	const cost = models.calls.reduce((sum, c) => sum + c.cost, 0)
	const fresh = models.calls.filter((c) => !c.cached).length
	console.log(
		`\n${name}: ${sim.topics.filter((t) => t.retiredAt === undefined).length} topics, ${models.calls.length} calls (${fresh} new), $${cost.toFixed(4)}`,
	)
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

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
