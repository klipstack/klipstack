import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { createAnthropic } from "@ai-sdk/anthropic"
import {
	type AiLanguage,
	type AnswerInput,
	type AnswerResult,
	type Citation,
	createAi,
	TIERS,
} from "@klipstack/ai"
import { extractArticle } from "@klipstack/extract"
import { generateText, Output } from "ai"
import { config as loadDotenv } from "dotenv"
import { z } from "zod"
import { getBlob, loadCapture, parseUrls } from "./demo/cache"

const root = fileURLToPath(new URL("../../../", import.meta.url))
loadDotenv({ path: resolve(root, ".env"), quiet: true })

const usage = `Usage: pnpm --filter @klipstack/web citations [options]

Asks the real model (ANTHROPIC_API_KEY) for briefs and answers about the demo corpus, as the app
does, and measures their citations: how many sit after words that repeat the cited passage, and,
with --judge, how many the passage supports. docs/development/citation-experiments.md says what it
showed.

Options:
  --cache PATH        The demo captures (default: .demo.local; pnpm demo:capture makes them)
  --limit N           Only the first N articles of at least 300 words (default: all)
  --spanish N         Also answer in Spanish about the first N articles (default: 0)
  --model ID          The model of the quick tier (default: ${TIERS.quick.model})
  --judge             Ask ${"claude-opus-5-5"} whether each cited passage supports its words
  --out PATH          The answers, one JSON per line (default: .citations/<date>.jsonl)
`

/** A citation's words repeat the article when they share at least this many characters with it. */
const COPIED = 30
const JUDGE = "claude-opus-5-5"
const CHAT = [
	"What is the main argument of this article?",
	"What evidence does the author give for the main claim?",
	"What does the author suggest the reader do?",
]
type Kind = "brief" | "explain" | "define" | "ask" | "chat"
const KINDS: Record<AiLanguage, Kind[]> = {
	en: ["brief", "explain", "define", "ask", "chat"],
	es: ["brief", "explain", "chat"],
}

interface Article {
	url: string
	title: string
	author: string | null
	siteName: string | null
	text: string
}

const normal = (s: string) =>
	s
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[—–]/g, "-")
		.replace(/\s+/g, " ")

/** The longest run of characters two texts share, compared without case or spacing. */
export function sharedRun(a: string, b: string): string {
	const [x, y] = [normal(a), normal(b)]
	let best = { length: 0, end: 0 }
	let previous = new Uint32Array(y.length + 1)
	for (let i = 1; i <= x.length; i++) {
		const current = new Uint32Array(y.length + 1)
		for (let j = 1; j <= y.length; j++)
			if (x[i - 1] === y[j - 1]) {
				current[j] = previous[j - 1]! + 1
				if (current[j]! > best.length) best = { length: current[j]!, end: i }
			}
		previous = current
	}
	return x.slice(best.end - best.length, best.end)
}

/**
 * The answer's citations, those in one place together (a bullet citing three sentences), each with
 * the words it follows: the sentence it ends, back to the citations before.
 */
export function citedPlaces(text: string, citations: Citation[]) {
	const places = [...new Set(citations.map((c) => c.at))].sort((a, b) => a - b)
	return places.map((at, i) => {
		const before = text.slice(0, at)
		const ends = [...before.matchAll(/[.!?]["”’)*]*\s+|\n/g)].map((m) => m.index + m[0].length)
		const words = before
			.slice(Math.max(places[i - 1] ?? 0, ends.at(-1) ?? 0))
			.replace(/^[-\s*.,;:]+/, "")
			.trim()
		const cited = citations
			.filter((c) => c.at === at)
			.map((c) => c.exact)
			.join(" … ")
		return { words, cited, shared: sharedRun(words, cited) }
	})
}

/** A sentence near 40% of the article, of 60 to 400 characters: the reader's passage. */
function passageOf(text: string, kind: "explain" | "define" | "ask") {
	const re = /[^.!?\n]{60,400}[.!?]/g
	re.lastIndex = Math.floor(text.length * 0.4)
	const found = re.exec(text) ?? /[^\n]{1,400}/.exec(text)!
	const exact = found[0].trim()
	let start = text.indexOf(exact, found.index)
	if (kind !== "define") return { exact, start, end: start + exact.length }
	// Define: a long word of it.
	const word = /\p{L}{9,}/u.exec(exact)?.[0] ?? exact
	start = text.indexOf(word, start)
	return { exact: word, start, end: start + word.length }
}

function threadOf(kind: Exclude<Kind, "brief">, text: string, i: number): AnswerInput["thread"] {
	if (kind === "chat")
		return {
			action: "chat",
			passage: { exact: "", start: 0, end: 0 },
			turns: [{ role: "user", text: CHAT[i % CHAT.length]! }],
		}
	return {
		action: kind,
		passage: passageOf(text, kind),
		turns: [{ role: "user", text: kind === "ask" ? "Why does the author think this?" : "" }],
	}
}

async function corpus(cache: string): Promise<Article[]> {
	const urls = parseUrls(
		await readFile(resolve(root, "apps/web/scripts/demo/reader-urls.txt"), "utf8"),
	)
	const articles: Article[] = []
	for (const url of urls) {
		const capture = await loadCapture(cache, url)
		if (!capture) continue
		const html = (await getBlob(cache, capture.page)).toString("utf8")
		const a = await extractArticle({ html, url: capture.page.finalUrl })
		if (a.wordCount >= 300)
			articles.push({ url, title: a.title, author: a.author, siteName: a.siteName, text: a.text })
	}
	return articles
}

const verdicts = z.object({
	verdicts: z.array(z.object({ item: z.number(), verdict: z.enum(["yes", "partly", "no"]) })),
})

/** Opus's verdict on each citation: does the passage support the words it follows? */
async function judge(text: string, items: { words: string; cited: string }[]) {
	if (!items.length) return []
	const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
	const { output } = await generateText({
		model: anthropic(JUDGE),
		maxOutputTokens: 8000,
		providerOptions: { anthropic: { effort: "low" } },
		output: Output.object({ schema: verdicts }),
		system: `You check citations in an AI answer about an article. For each numbered item you get the words of the answer a citation is attached to, and the passage of the article it cites. Judge only whether the passage supports those words: "yes" if the passage states or directly implies what the words say, "partly" if it supports some of it and the rest is not in the passage, "no" if it does not support it. Ignore style and wording.`,
		prompt: `The whole answer, for context:\n<answer>\n${text}\n</answer>\n\n${items
			.map(
				(c, i) =>
					`Item ${i + 1}\nWords: ${c.words}\nCited passage: ${c.cited.replace(/\s+/g, " ").trim()}`,
			)
			.join("\n\n")}\n\nGive one verdict per item, in order.`,
	})
	return output.verdicts.map((v) => v.verdict)
}

async function main() {
	const { values } = parseArgs({
		options: {
			cache: { type: "string", default: ".demo.local" },
			limit: { type: "string" },
			spanish: { type: "string", default: "0" },
			model: { type: "string" },
			judge: { type: "boolean" },
			out: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	})
	if (values.help) return console.log(usage)
	if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set")
	if (values.model) TIERS.quick.model = values.model
	const out = resolve(
		root,
		values.out ?? `.citations/${new Date().toISOString().slice(0, 19)}.jsonl`,
	)
	await mkdir(dirname(out), { recursive: true })
	const ai = createAi({ anthropicApiKey: process.env.ANTHROPIC_API_KEY })
	const articles = (await corpus(resolve(root, values.cache))).slice(
		0,
		values.limit ? Number(values.limit) : undefined,
	)
	if (!articles.length) throw new Error("No captures: run pnpm demo:capture first")

	const jobs = articles.flatMap((a, i) =>
		(["en", "es"] as const)
			.filter((language) => language === "en" || i < Number(values.spanish))
			.flatMap((language) => KINDS[language].map((kind) => ({ a, i, language, kind }))),
	)
	console.log(`${articles.length} articles, ${jobs.length} requests to ${TIERS.quick.model}`)
	const rows: { language: AiLanguage; kind: Kind; copied: number; cites: number; v: string[] }[] =
		[]
	let next = 0
	await Promise.all(
		Array.from({ length: 8 }, async () => {
			while (next < jobs.length) {
				const { a, i, language, kind } = jobs[next++]!
				const article = { title: a.title, author: a.author, siteName: a.siteName, text: a.text }
				let result: AnswerResult
				try {
					const answer =
						kind === "brief"
							? ai.brief({ article, language })
							: ai.answer({ tier: "quick", article, thread: threadOf(kind, a.text, i), language })
					for await (const _ of answer.events);
					result = await answer.done
				} catch (error) {
					console.error(`${kind} ${language} ${a.url}: ${String(error)}`)
					continue
				}
				const cites = citedPlaces(result.text, result.citations)
				const v = values.judge ? await judge(result.text, cites).catch(() => []) : []
				const copied = cites.filter((c) => c.shared.length >= COPIED).length
				rows.push({ language, kind, copied, cites: cites.length, v })
				await appendFile(
					out,
					`${JSON.stringify({ url: a.url, language, kind, text: result.text, usage: result.usage, cites, verdicts: v })}\n`,
				)
			}
		}),
	)

	console.log(
		`\nPlaces cited, and those after words that repeat ${COPIED}+ characters of the passage:`,
	)
	for (const language of ["en", "es"] as const)
		for (const kind of [...KINDS[language], "all"] as const) {
			const rs = rows.filter((r) => r.language === language && (kind === "all" || r.kind === kind))
			if (!rs.length) continue
			const sum = (f: (r: (typeof rows)[number]) => number) => rs.reduce((s, r) => s + f(r), 0)
			const all = rs.flatMap((r) => r.v)
			const share = (x: string) =>
				`${Math.round((100 * all.filter((v) => v === x).length) / all.length)}%`
			console.log(
				`  ${language} ${kind.padEnd(8)} ${sum((r) => r.copied)}/${sum((r) => r.cites)} (${Math.round(
					(100 * sum((r) => r.copied)) /
						Math.max(
							1,
							sum((r) => r.cites),
						),
				)}%)${
					all.length
						? `  supported: ${share("yes")} yes, ${share("partly")} partly, ${share("no")} no`
						: ""
				}`,
			)
		}
	console.log(`\nAnswers: ${out}`)
}

await main()
