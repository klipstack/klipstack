#!/usr/bin/env node
// The rules of .agents/checks/ that a script can decide, so no reviewer has to: `pnpm verify` and
// CI run it. The judgment parts stay in the check files. Tested by check-rules.test.mjs.
//
// Usage: node scripts/check-rules.mjs [--base REF] [--pr]
//
//   --base REF  what merged migrations are read from (default: where HEAD left origin/main)
//   --pr        check only the text on stdin, a pull request's title and description
//
// It checks every file git tracks or would add (untracked files not ignored):
//   public-repo  no secrets, no .env file, no agent credited (Co-authored-by, "Generated with",
//                links to agent threads or sessions)
//   migrations   no migration merged into the base is edited or deleted, and the journal, the SQL
//                files and the snapshots name each other
//   security     every test docs/security.md names exists
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/** What looks like a real secret. Placeholders such as `-----BEGIN PRIVATE KEY-----\n…` pass. */
const SECRETS = [
	["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----(["'`]?\s*$|\\n[A-Za-z0-9+/]{20})/],
	["an AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
	["a GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})\b/],
	["a Slack token", /\bxox[abeprs]-[A-Za-z0-9-]{10,}/],
	["an Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
	["an OpenAI key", /\bsk-((proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})/],
	["a Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
	["a Stripe key", /\b[sr]k_live_[0-9A-Za-z]{20,}/],
]

const AGENTS = String.raw`(amp|claude|anthropic|cursor|copilot|codex|chatgpt|openai|gemini|devin)`
/** An agent credited in a file or a pull request (AGENTS.md, "Commits, Branches and Releases"). */
const CREDITS = [
	["an agent as co-author", new RegExp(String.raw`^\W*co-authored-by:.*\b${AGENTS}\b`, "i")],
	["an agent's thread ID", /^\W*amp-thread-id:/i],
	['a "Generated with" line', new RegExp(String.raw`generated (with|by) \W*${AGENTS}\b`, "i")],
	[
		"a link to an agent's thread or session",
		/\b(ampcode\.com\/threads\/|claude\.ai\/(code|chat|share)\b|chatgpt\.com\/(share|c)\/)/i,
	],
]

/** The problems in one file's text: `{line, message}`. */
export function textProblems(text) {
	const problems = []
	text.split("\n").forEach((line, i) => {
		// Code in backticks names a credit, as the rules about credits do; it gives none.
		const prose = line.replace(/`[^`]*`/g, "")
		for (const [what, pattern] of SECRETS)
			if (pattern.test(line))
				problems.push({
					line: i + 1,
					message: `${what}. This repository is public: take it out, and revoke it if it is real.`,
				})
		for (const [what, pattern] of CREDITS)
			if (pattern.test(prose))
				problems.push({
					line: i + 1,
					message: `${what}. Agents are not credited here; credit the humans who did the work.`,
				})
	})
	return problems
}

const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/
const ENV_EXAMPLE = /(^|\/)\.env\.example$/

/** A file named like .env, which holds secrets and stays untracked. */
export function pathProblem(path) {
	return ENV_FILE.test(path) && !ENV_EXAMPLE.test(path)
		? `${path}: an environment file. It holds secrets: keep it out of git (.gitignore).`
		: null
}

const DRIZZLE = "packages/db/drizzle"

/**
 * Migrations: `files(ref)` lists the paths under packages/db/drizzle at the base (`"base"`) and in
 * the working tree (`"tree"`), `read(ref, path)` reads one. A migration merged into the base is
 * final: production ran it, and a change to it would never run there.
 */
export function migrationProblems(files, read) {
	const problems = []
	const base = files("base")
	const tree = new Set(files("tree"))
	for (const path of base) {
		if (path.endsWith("_journal.json")) continue
		if (!tree.has(path))
			problems.push(`${path}: a merged migration was deleted. Restore it; undo it in a new one.`)
		else if (read("base", path) !== read("tree", path))
			problems.push(
				`${path}: a merged migration was edited. Production already ran it: restore it, and write the change as a new migration (\`pnpm db:generate\`, or \`--custom\`).`,
			)
	}
	const journal = (ref) =>
		JSON.parse(read(ref, `${DRIZZLE}/meta/_journal.json`) ?? '{"entries":[]}')
	const before = base.includes(`${DRIZZLE}/meta/_journal.json`) ? journal("base").entries : []
	const after = journal("tree").entries
	before.forEach((entry, i) => {
		if (JSON.stringify(after[i]) !== JSON.stringify(entry))
			problems.push(
				`${DRIZZLE}/meta/_journal.json: the merged entry ${entry.tag} changed. Only add entries after the last one.`,
			)
	})
	const tags = new Set(after.map((e) => e.tag))
	for (const entry of after) {
		if (!tree.has(`${DRIZZLE}/${entry.tag}.sql`))
			problems.push(`${DRIZZLE}/meta/_journal.json: ${entry.tag} has no ${entry.tag}.sql.`)
		const snapshot = `${DRIZZLE}/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`
		if (!tree.has(snapshot))
			problems.push(`${DRIZZLE}/meta/_journal.json: ${entry.tag} has no snapshot (${snapshot}).`)
	}
	for (const path of tree) {
		const sql = path.match(new RegExp(`^${DRIZZLE}/([^/]+)\\.sql$`))
		if (sql && !tags.has(sql[1]))
			problems.push(
				`${path}: not in meta/_journal.json, so it never runs. Generate migrations with \`pnpm db:generate\`.`,
			)
	}
	return problems
}

/**
 * The tests docs/security.md names, in backticks: paths relative to apps/web/ unless they start
 * with another workspace (`apps/…`, `packages/…`), and `*` matching within a file name. `files`
 * lists the working tree's.
 */
export function securityDocProblems(doc, files) {
	const problems = []
	const named = new Set()
	for (const [, path] of doc.matchAll(/`([\w./*-]+\.(?:test|spec)\.[cm]?[jt]sx?)`/g))
		named.add(path)
	for (const path of named) {
		const full = /^(apps|packages)\//.test(path) ? path : `apps/web/${path}`
		const pattern = new RegExp(
			`^${full.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`,
		)
		if (!files.some((f) => pattern.test(f)))
			problems.push(
				`docs/security.md names \`${path}\`, and no such test exists (${full}). Point the row at the test that holds the boundary now.`,
			)
	}
	return problems
}

function git(...args) {
	return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
}

function main(args) {
	if (args.includes("--pr")) {
		const problems = textProblems(readFileSync(0, "utf8"))
		for (const p of problems) console.error(`pull request, line ${p.line}: ${p.message}`)
		process.exit(problems.length ? 1 : 0)
	}
	const at = args.indexOf("--base")
	let base = at >= 0 ? args[at + 1] : ""
	if (at >= 0 && !base) throw new Error("--base needs a ref")
	process.chdir(git("rev-parse", "--show-toplevel").trim())
	if (!base) {
		const upstream = ["origin/main", "main"].find((ref) => {
			try {
				git("rev-parse", "-q", "--verify", `${ref}^{commit}`)
				return true
			} catch {
				return false
			}
		})
		if (!upstream) throw new Error("No origin/main or main to compare with: pass --base REF.")
		base = upstream
	}
	base = git("merge-base", base, "HEAD").trim()

	const files = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
		.split("\0")
		.filter((f) => f && existsSync(f))
	const problems = []
	for (const path of files) {
		const problem = pathProblem(path)
		if (problem) problems.push(problem)
		if (statSync(path).size > 4 * 1024 * 1024) continue
		const content = readFileSync(path)
		if (content.includes(0)) continue
		for (const p of textProblems(content.toString("utf8")))
			problems.push(`${path}:${p.line}: ${p.message}`)
	}
	const drizzle = new Set(files.filter((f) => f.startsWith(`${DRIZZLE}/`)))
	const baseDrizzle = git("ls-tree", "-r", "--name-only", base, "--", DRIZZLE)
		.split("\n")
		.filter(Boolean)
	problems.push(
		...migrationProblems(
			(ref) => (ref === "base" ? baseDrizzle : [...drizzle]),
			(ref, path) => {
				if (ref === "tree") return existsSync(path) ? readFileSync(path, "utf8") : null
				try {
					return git("show", `${base}:${path}`)
				} catch {
					return null
				}
			},
		),
	)
	problems.push(...securityDocProblems(readFileSync(join("docs", "security.md"), "utf8"), files))

	for (const problem of problems) console.error(problem)
	if (problems.length) {
		console.error(
			`\n${problems.length} problem${problems.length === 1 ? "" : "s"} (scripts/check-rules.mjs).`,
		)
		process.exit(1)
	}
	console.log(
		`Rules hold: ${files.length} files, migrations since ${base.slice(0, 7)}, docs/security.md.`,
	)
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
