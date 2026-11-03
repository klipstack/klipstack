// node --test scripts/*.test.mjs: the rules of scripts/check-rules.mjs.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, describe, test } from "node:test"
import {
	migrationProblems,
	pathProblem,
	securityDocProblems,
	textProblems,
} from "./check-rules.mjs"

const script = join(import.meta.dirname, "check-rules.mjs")
const messages = (text) => textProblems(text).map((p) => `${p.line}: ${p.message}`)

// Built from pieces, so that this file does not hold what it looks for.
const thread = `https://ampcode.com/${"threads"}/T-0193f2a1-5b8d-4f3e-9a16-2d4b8e0c7f53`
const githubToken = `ghp_${"a1B2c3D4e5F6g7H8i9J0".repeat(2).slice(0, 36)}`

describe("textProblems", () => {
	test("reports secrets, with the line", () => {
		const text = ["const ok = 1", `token: ${githubToken}`].join("\n")
		assert.deepEqual(messages(text), [
			"2: a GitHub token. This repository is public: take it out, and revoke it if it is real.",
		])
		for (const secret of [
			`AKIA${"ABCDEFGHIJKLMNOP"}`,
			`ASIA${"ABCDEFGHIJKLMNOP"}`,
			`github_pat_${"A1b2_".repeat(9)}`,
			`sk-${"A1b2C3d4".repeat(5)}`,
			`sk-proj-${"Ab3_dE5f-".repeat(5)}`,
			`sk-svcacct-${"A1b2C3d4".repeat(4)}`,
			`sk_live_${"A1b2C3d4".repeat(3)}`,
			`const key = \`-----BEGIN ${"PRIVATE"} KEY-----`,
			`APPLE_KEY="-----BEGIN ${"PRIVATE"} KEY-----`,
			`sk-ant-api03-${"x".repeat(30)}`,
			`AIza${"S".repeat(35)}`,
			`xoxb-${"1234567890"}-abc`,
			`-----BEGIN RSA ${"PRIVATE"} KEY-----`,
			`KEY="-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC"`,
		])
			assert.equal(textProblems(secret).length, 1, secret)
	})

	test("accepts placeholders and look-alikes", () => {
		for (const text of [
			"# APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
			"BETTER_AUTH_SECRET: ci-secret-ci-secret-ci-secret-ci-secret",
			"const task = 'ask-anthropic'",
			"ghp_short",
		])
			assert.deepEqual(textProblems(text), [], text)
	})

	test("reports agents credited", () => {
		for (const text of [
			`Co-${"authored-by"}: Amp <amp@ampcode.com>`,
			`  co-${"authored-by"}: Claude <noreply@anthropic.com>`,
			`Amp-${"Thread-ID"}: T-1`,
			`🤖 ${"Generated"} with [Claude Code](https://claude.com/claude-code)`,
			`See ${thread}`,
			`https://claude.ai/${"code"}/session_01`,
		])
			assert.match(messages(text).join(), /Agents are not credited here/, text)
	})

	test("accepts people credited, and the rule itself written down", () => {
		for (const text of [
			"Co-authored-by: Ada Lovelace <ada@example.com>",
			"no agent as author or `Co-authored-by`, no links to agent sessions (ampcode.com, claude.ai)",
			"A branch's commits may keep the `Co-authored-by: Amp` and `Amp-Thread-ID` lines",
			"Source: Amp's [review checks](https://ampcode.com/news/liberating-code-review).",
			`- \`Amp-${"Thread-ID"}: …\` lines are fine on a branch.`,
		])
			assert.deepEqual(textProblems(text), [], text)
	})
})

test("pathProblem refuses environment files but the example", () => {
	assert.match(pathProblem(".env"), /keep it out of git/)
	assert.match(pathProblem("apps/web/.env.production"), /keep it out of git/)
	assert.equal(pathProblem(".env.example"), null)
	assert.equal(pathProblem("apps/web/app/lib/env.server.ts"), null)
})

describe("migrationProblems", () => {
	const d = "packages/db/drizzle"
	const journal = (...tags) =>
		JSON.stringify({ entries: tags.map((tag, idx) => ({ idx, tag, breakpoints: true })) })
	const merged = {
		[`${d}/0000_a.sql`]: "CREATE TABLE a ();",
		[`${d}/meta/0000_snapshot.json`]: "{}",
		[`${d}/meta/_journal.json`]: journal("0000_a"),
	}
	const check = (tree, base = merged) =>
		migrationProblems(
			(ref) => Object.keys(ref === "base" ? base : tree),
			(ref, path) => (ref === "base" ? base : tree)[path] ?? null,
		)
	const added = {
		...merged,
		[`${d}/0001_b.sql`]: "ALTER TABLE a ADD b int;",
		[`${d}/meta/0001_snapshot.json`]: "{}",
		[`${d}/meta/_journal.json`]: journal("0000_a", "0001_b"),
	}

	test("accepts a new migration after the merged ones", () => {
		assert.deepEqual(check(merged), [])
		assert.deepEqual(check(added), [])
	})

	test("reports a merged migration edited or deleted", () => {
		const [edited] = check({ ...added, [`${d}/0000_a.sql`]: "CREATE TABLE a (b int);" })
		assert.match(edited, /0000_a\.sql: a merged migration was edited/)
		const { [`${d}/meta/0000_snapshot.json`]: _, ...gone } = added
		assert.match(check(gone).join(), /0000_snapshot\.json: a merged migration was deleted/)
	})

	test("reports a merged journal entry changed", () => {
		const tree = { ...added, [`${d}/meta/_journal.json`]: journal("0001_b", "0000_a") }
		assert.match(check(tree).join(), /the merged entry 0000_a changed/)
	})

	test("reports SQL, journal and snapshots that do not name each other", () => {
		const { [`${d}/meta/0001_snapshot.json`]: _, ...noSnapshot } = added
		assert.match(check(noSnapshot).join(), /0001_b has no snapshot/)
		const { [`${d}/0001_b.sql`]: __, ...noSql } = added
		assert.match(check(noSql).join(), /0001_b has no 0001_b\.sql/)
		const stray = { ...merged, [`${d}/0001_b.sql`]: "DROP TABLE a;" }
		assert.match(check(stray).join(), /0001_b\.sql: not in meta\/_journal\.json, so it never runs/)
	})
})

test("securityDocProblems reports a test the doc names that does not exist", () => {
	const doc = [
		"| Boundary | Rule | Tests |",
		"| Exports | … | `app/services/export.server.test.ts`, `app/services/admin-*.server.test.ts` |",
		"| Fetching | … | `packages/extract/test/fetch.test.ts`, `e2e/gone.spec.ts`, `packages/ai/src/*.test.ts` |",
	].join("\n")
	const files = [
		"apps/web/app/services/export.server.test.ts",
		"apps/web/app/services/admin-jobs.server.test.ts",
		"packages/extract/test/fetch.test.ts",
	]
	assert.deepEqual(securityDocProblems(doc, files), [
		"docs/security.md names `e2e/gone.spec.ts`, and no such test exists (apps/web/e2e/gone.spec.ts). Point the row at the test that holds the boundary now.",
		"docs/security.md names `packages/ai/src/*.test.ts`, and no such test exists (packages/ai/src/*.test.ts). Point the row at the test that holds the boundary now.",
	])
})

describe("the script", () => {
	const dir = mkdtempSync(join(tmpdir(), "check-rules-test-"))
	after(() => rmSync(dir, { recursive: true, force: true }))
	const write = (path, text) => {
		mkdirSync(dirname(join(dir, path)), { recursive: true })
		writeFileSync(join(dir, path), text)
	}
	const sh = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" })
	const run = (...args) => spawnSync("node", [script, ...args], { cwd: dir, encoding: "utf8" })

	test("passes a clean checkout, and names each file and line that breaks a rule", () => {
		sh("init", "-q", "-b", "main")
		write("docs/security.md", "| A | B | `app/a.test.ts` |\n")
		write("apps/web/app/a.test.ts", "")
		write("packages/db/drizzle/0000_a.sql", "CREATE TABLE a ();")
		write("packages/db/drizzle/meta/0000_snapshot.json", "{}")
		write("packages/db/drizzle/meta/_journal.json", '{"entries":[{"idx":0,"tag":"0000_a"}]}')
		sh("add", "-A")
		sh("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "base")
		const clean = run("--base", "main")
		assert.equal(clean.status, 0, clean.stderr)

		write("packages/db/drizzle/0000_a.sql", "CREATE TABLE a (b int);")
		write("notes.md", `Line one\nSee ${thread}\n`)
		write("apps/web/.env.production", "DATABASE_URL=x\n")
		const broken = run("--base", "main")
		assert.equal(broken.status, 1)
		assert.match(broken.stderr, /^notes\.md:2: a link to an agent's thread/m)
		assert.match(broken.stderr, /0000_a\.sql: a merged migration was edited/)
		assert.match(broken.stderr, /^apps\/web\/\.env\.production: an environment file/m)
		assert.match(broken.stderr, /3 problems/)
	})

	test("--pr checks a pull request's text from stdin", () => {
		const pr = (input) => spawnSync("node", [script, "--pr"], { input, encoding: "utf8" })
		assert.equal(pr("feat: x\n\nAdds x.").status, 0)
		const credited = pr(`feat: x\n\nAdds x.\n\n${thread}`)
		assert.equal(credited.status, 1)
		assert.match(credited.stderr, /pull request, line 5: a link to an agent's thread/)
	})
})
