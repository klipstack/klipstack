#!/usr/bin/env node
// Guardrails for coding agents, shared by Claude Code (.claude/settings.json) and Amp
// (.amp/plugins/klipstack-guardrails.ts), so both enforce the same rules. docs/development/agents.md
// explains them.
//
//   agent-hook.mjs claude                     a Claude Code hook: reads its event from stdin
//   agent-hook.mjs turn-start <session>       remember the working tree as a turn begins
//   agent-hook.mjs turn-end <session>         exit 2, with the reason on stderr, when the turn
//                                             changed code that `pnpm verify` has not passed
//   agent-hook.mjs guard <command>            exit 2, with the reason on stderr, for a shell
//                                             command that breaks a rule of AGENTS.md
//   agent-hook.mjs mark-verified <tree>       record a tree `pnpm verify` passed (scripts/verify)
//   agent-hook.mjs change-id <base>           print the change since <base> (a patch id), when
//                                             it is all committed; nothing otherwise
//   agent-hook.mjs mark-ci-passed <change>    record a change `pnpm ci:local` passed (scripts/ci-local)
//   agent-hook.mjs fingerprint                print the working tree's fingerprint
//
// A fingerprint is the tree hash of the working tree, untracked files included (.gitignore
// applies): equal fingerprints mean equal files. Hooks fail open: an error here never stops an
// agent, it only skips the check.
import { execFileSync } from "node:child_process"
import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const git = (args, env) =>
	execFileSync("git", args, {
		encoding: "utf8",
		env: env ? { ...process.env, ...env } : process.env,
		stdio: ["ignore", "pipe", "ignore"],
	}).trim()

const stateDir = () => {
	const dir = git(["rev-parse", "--path-format=absolute", "--git-path", "klipstack-agent"])
	mkdirSync(dir, { recursive: true })
	return dir
}
const readState = (name) => {
	try {
		return readFileSync(join(stateDir(), name), "utf8").trim()
	} catch {
		return ""
	}
}
const writeState = (name, value) => writeFileSync(join(stateDir(), name), `${value}\n`)
const sessionFile = (session) => `turn-${String(session).replace(/[^A-Za-z0-9_-]/g, "_")}`

// Fingerprints write the blobs of changed and untracked files into an object store of their own,
// beside this script's state, so a large untracked file never lands in the repository's store.
// Git reads the repository's objects through the alternates; a day is enough to keep ours.
function objectsEnv() {
	const repository = git(["rev-parse", "--path-format=absolute", "--git-path", "objects"])
	const own = join(stateDir(), "objects")
	mkdirSync(own, { recursive: true })
	return { GIT_OBJECT_DIRECTORY: own, GIT_ALTERNATE_OBJECT_DIRECTORIES: repository }
}

function pruneObjects() {
	const own = objectsEnv().GIT_OBJECT_DIRECTORY
	const dayAgo = Date.now() - 24 * 60 * 60 * 1000
	for (const entry of readdirSync(own, { recursive: true, withFileTypes: true })) {
		const file = join(entry.parentPath, entry.name)
		if (entry.isFile() && statSync(file).mtimeMs < dayAgo) rmSync(file, { force: true })
	}
}

export function fingerprint() {
	// A copy of the index keeps git's file-stat cache, so this takes well under a second. The copy
	// keeps the index's times too: git rereads a file changed in the same second as the index was
	// written ("racy git") only when it knows when that was.
	const index = join(tmpdir(), `klipstack-fingerprint-${process.pid}`)
	try {
		const source = git(["rev-parse", "--path-format=absolute", "--git-path", "index"])
		copyFileSync(source, index)
		const { atime, mtime } = statSync(source)
		utimesSync(index, atime, mtime)
	} catch {
		rmSync(index, { force: true })
	}
	try {
		const top = git(["rev-parse", "--show-toplevel"])
		const env = { ...objectsEnv(), GIT_INDEX_FILE: index }
		git(["-C", top, "add", "-A", "."], env)
		return git(["-C", top, "write-tree"], env)
	} finally {
		rmSync(index, { force: true })
	}
}

function turnStart(session) {
	pruneObjects()
	writeState(sessionFile(session), fingerprint())
}

// What scripts/ci-local and scripts/verify skip too: no check reads Markdown or docs/.
const isCode = (file) => !/^docs\/|\.md$/.test(file)

export function turnEnd(session) {
	const now = fingerprint()
	const start = readState(sessionFile(session)) || git(["rev-parse", "HEAD^{tree}"])
	if (now === start || now === readState("verified")) return null
	const code = git(["diff-tree", "-r", "--name-only", start, now], objectsEnv())
		.split("\n")
		.filter((file) => file && isCode(file))
	if (code.length === 0) return null
	const shown =
		code.slice(0, 5).join(", ") + (code.length > 5 ? `, and ${code.length - 5} more` : "")
	return [
		`This turn changed code (${shown}) that \`pnpm verify\` has not passed in its current state.`,
		"Before you finish: run `pnpm verify` and fix what it reports, prove the change on the surface",
		"it affects (.claude/skills/verify/SKILL.md), and report what you ran and saw. If you are",
		"stopping on purpose with work unfinished or unverified, say so plainly and say what is left.",
	].join(" ")
}

// A change's patch id (`git patch-id --verbatim`: whitespace counts, binary files too). It ignores
// line numbers, so a commit rebased without conflicts keeps it: what `pnpm ci:local` passed before
// another agent's push is the same change after the rebase.
function patchId(from, to) {
	const maxBuffer = 1 << 30
	const diff = execFileSync("git", ["diff", "--binary", from, to], { maxBuffer })
	const out = execFileSync("git", ["patch-id", "--verbatim"], { input: diff, maxBuffer })
	return out.toString().split(" ")[0].trim()
}

// The change from where HEAD left <base> to HEAD, when the working tree holds nothing else.
export function changeId(base) {
	if (fingerprint() !== git(["rev-parse", "HEAD^{tree}"])) return ""
	return patchId(git(["merge-base", base, "HEAD"]), "HEAD")
}

const isAncestor = (a, b) => {
	try {
		git(["merge-base", "--is-ancestor", a, b])
		return true
	} catch {
		return false
	}
}

// What `main` must not carry (AGENTS.md): an agent as author or co-author, links to its threads.
const agentCredit =
	/^(co-authored-by:.*\b(amp|claude)\b.*|amp-thread-id:.*)$|@(ampcode|anthropic)\.com|ampcode\.com\/threads|claude\.ai\/|generated with \W*(amp|claude)/im

// Why the commit <rev> may not be pushed to `main` yet; null when it may (.claude/skills/release).
// One commit on top of origin/main, crediting no agent, whose tree passed `pnpm verify` and whose
// change passed `pnpm ci:local`.
export function shipProblem(rev) {
	const commit = git(["rev-parse", "--verify", `${rev}^{commit}`])
	const main = "refs/remotes/origin/main"
	const release = "(.claude/skills/release/SKILL.md)"
	if (!isAncestor(main, commit)) {
		return `${rev} is not on top of \`origin/main\`: \`git fetch origin && git rebase origin/main\`, then \`pnpm verify\`, and push again ${release}.`
	}
	const ahead = Number(git(["rev-list", "--count", `${main}..${commit}`]))
	if (ahead === 0) return null
	if (ahead > 1) {
		return `${rev} is ${ahead} commits ahead of \`origin/main\`: \`main\` takes one commit per change. Squash them: \`git reset --soft origin/main && git commit -m "<type>: <what changed>"\` ${release}.`
	}
	if (agentCredit.test(git(["log", "-1", "--format=%an <%ae>%n%cn <%ce>%n%B", commit]))) {
		return `${rev} credits an agent (author, Co-authored-by, Amp-Thread-ID or a thread link), which \`main\` must not carry (AGENTS.md). Rewrite it: \`git commit --amend --reset-author -m "<type>: <what changed>"\`, with no trailers.`
	}
	if (git(["rev-parse", `${commit}^{tree}`]) !== readState("verified")) {
		return `\`pnpm verify\` has not passed on ${rev} as it is. Check it out with a clean working tree, run \`pnpm verify\`, and push again ${release}.`
	}
	const change = patchId(`${commit}^`, commit)
	if (!change || change !== readState("ci-passed")) {
		return `\`pnpm ci:local\` has not passed on this change. Run it on ${rev}, with a clean working tree, and push again. A rebase without conflicts keeps a pass ${release}.`
	}
	return null
}

// Splits a shell line into simple commands and their words. Rough, but enough to find `git`
// invocations: quotes are honoured, so a commit message that says "main" is one word; heredoc
// bodies and redirections (`2>&1`, `>log`) are not words.
function commands(line) {
	const result = []
	let words = []
	let word = ""
	let quote = ""
	let inWord = false
	let skipWord = false
	const heredocs = []
	const endWord = () => {
		if (inWord && !skipWord) words.push(word)
		if (inWord) skipWord = false
		word = ""
		inWord = false
	}
	const endCommand = () => {
		endWord()
		skipWord = false
		if (words.length) result.push(words)
		words = []
	}
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (quote) {
			if (c === quote) quote = ""
			else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line[++i]
			else word += c
		} else if (c === "'" || c === '"') {
			quote = c
			inWord = true
		} else if (c === "\\" && line[i + 1] === "\n") {
			i++
		} else if (c === "#" && !inWord) {
			while (i + 1 < line.length && line[i + 1] !== "\n") i++
		} else if (c === "\\" && i + 1 < line.length) {
			word += line[++i]
			inWord = true
		} else if (c === "<" && line[i + 1] === "<" && line[i + 2] !== "<") {
			// A heredoc: its body, from the next line to the delimiter, is input, not commands.
			const match = /^<<(-?)\s*(['"]?)([A-Za-z0-9_]+)\2(?=$|[\s;|&)<>])/.exec(line.slice(i))
			const before = line.slice(0, i)
			const arithmetic = before.split("((").length > before.split("))").length
			if (match && !arithmetic) {
				endWord()
				heredocs.push({ delimiter: match[3], tabs: match[1] === "-" })
				i += match[0].length - 1
			}
		} else if (c === ">" || c === "<") {
			// A redirection: drop the file descriptor before it and the target after it.
			if (inWord && /^\d+$/.test(word)) {
				word = ""
				inWord = false
			} else endWord()
			if (line[i + 1] === ">" || line[i + 1] === "<") i++
			if (line[i + 1] === "&") {
				i++
				while (/[\d-]/.test(line[i + 1] ?? "")) i++
			} else skipWord = true
		} else if (/\s/.test(c) && c !== "\n") {
			endWord()
		} else if (c === "\n" || c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
			endCommand()
			if (c === "\n") {
				for (const { delimiter, tabs } of heredocs.splice(0)) {
					while (i < line.length) {
						const next = line.indexOf("\n", i + 1)
						const end = next < 0 ? line.length : next
						const text = line.slice(i + 1, end)
						i = end
						if ((tabs ? text.replace(/^\t+/, "") : text) === delimiter) break
					}
				}
			}
		} else {
			word += c
			inWord = true
		}
	}
	endCommand()
	return result
}

// Words that can stand before the command a shell runs: keywords, wrappers, their options and
// durations, and variable assignments. `echo git push` is not git; `if git …`, `sudo git …` and
// `timeout 60 git …` are.
const prefixes = new Set([
	"if",
	"then",
	"else",
	"elif",
	"do",
	"while",
	"until",
	"!",
	"{",
	"time",
	"command",
	"exec",
	"env",
	"sudo",
	"timeout",
	"nohup",
	"nice",
	"xargs",
])
const isPrefix = (word) =>
	prefixes.has(word) ||
	/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) ||
	word.startsWith("-") ||
	/^\d+[smhd]?$/.test(word)

// `FOO=1 git -C dir -c a=b push …` → { sub: "push", args: [...] }; null when the command is not git.
function gitInvocation(words) {
	let i = 0
	while (i < words.length && words[i] !== "git" && !words[i].endsWith("/git") && isPrefix(words[i]))
		i++
	if (words[i] !== "git" && !words[i]?.endsWith("/git")) return null
	i++
	let elsewhere = false
	while (i < words.length && words[i].startsWith("-")) {
		if (["-C", "--git-dir", "--work-tree"].includes(words[i])) elsewhere = true
		if (["-C", "-c", "--git-dir", "--work-tree"].includes(words[i])) i++
		i++
	}
	return i < words.length ? { sub: words[i], args: words.slice(i + 1), elsewhere } : null
}

const isBranch = (name) => {
	if (!name || name === "-" || name.startsWith("-")) return name === "-"
	try {
		git(["rev-parse", "-q", "--verify", `refs/heads/${name}`])
		return true
	} catch {
		return name === "main"
	}
}

const currentBranch = () => {
	try {
		return git(["symbolic-ref", "--short", "-q", "HEAD"])
	} catch {
		return ""
	}
}

// The words that are not options, skipping the values of the options named.
function positionals(args, valued) {
	const result = []
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--") return [...result, ...args.slice(i + 1)]
		if (valued.includes(args[i])) i++
		else if (!args[i].startsWith("-")) result.push(args[i])
	}
	return result
}

// Whether `git commit` skips its hooks: `--no-verify` (or an abbreviation git accepts), or `-n`
// in a group of short options before one that takes a value (`-anm x` skips; `-mn` is message "n").
function commitSkipsHooks(args) {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === "--") return false
		if (arg.startsWith("--")) {
			if (arg.length > 6 && "--no-verify".startsWith(arg)) return true
			if (
				[
					"--message",
					"--file",
					"--author",
					"--date",
					"--template",
					"--reuse-message",
					"--reedit-message",
					"--fixup",
					"--squash",
					"--trailer",
					"--cleanup",
				].includes(arg)
			)
				i++
			continue
		}
		if (!arg.startsWith("-")) continue
		for (let j = 1; j < arg.length; j++) {
			if (arg[j] === "n") return true
			if ("mFCctSu".includes(arg[j])) {
				if (j === arg.length - 1 && !"Su".includes(arg[j])) i++
				break
			}
		}
	}
	return false
}

const skipsHooks = (sub, args) =>
	sub === "commit"
		? commitSkipsHooks(args)
		: args.some((a) => a.length > 6 && "--no-verify".startsWith(a))

// `branch` stands in for the current branch, and `ship` for shipProblem, for tests. A line that
// switches branches before it commits or pushes is read in order: `git switch -c x && git commit`
// commits on x.
export function guard(line, branch = currentBranch(), ship = shipProblem) {
	let current = branch
	let moved = false
	for (const words of commands(line)) {
		if (words[0] === "cd" || words[0] === "pushd") moved = true
		const call = gitInvocation(words)
		if (!call) continue
		const { sub, args } = call
		if (
			["commit", "push", "merge", "cherry-pick", "revert", "am"].includes(sub) &&
			skipsHooks(sub, args)
		) {
			return "`--no-verify` skips the checks this repository relies on (release skill). Fix what the hook reports instead."
		}
		if (sub === "switch" || sub === "checkout") {
			const create = args.findIndex((a) =>
				["-c", "-C", "-b", "-B", "--create", "--force-create"].includes(a),
			)
			const [target] = create >= 0 ? [args[create + 1]] : positionals(args, ["--conflict"])
			// `git checkout <path>` restores files: only an existing branch is a switch.
			if (sub === "checkout" && create < 0 && !isBranch(target)) continue
			current = target === undefined ? current : target === "-" ? "" : target
			continue
		}
		if (["commit", "merge", "cherry-pick", "revert", "am"].includes(sub) && current === "main") {
			return "Never commit on `main` (AGENTS.md). Create a branch first: `git switch -c <type>/<short-name>`; uncommitted changes come along."
		}
		if (sub === "push") {
			if (args.includes("--all") || args.includes("--mirror")) {
				return "`git push --all` or `--mirror` would push every branch. Push one: `git push origin HEAD:main` to release (release skill), `git push -u origin HEAD` for a branch."
			}
			const refspecs = positionals(args, [
				"-o",
				"--push-option",
				"--repo",
				"--receive-pack",
				"--exec",
			]).slice(1)
			if (refspecs.length === 0 && args.includes("--tags")) continue
			const deletes = args.includes("--delete") || args.includes("-d")
			const forced = args.some(
				(a) =>
					/^-[A-Za-z]*f/.test(a) ||
					a === "--force" ||
					a.startsWith("--force-with-lease") ||
					a === "--force-if-includes",
			)
			const pushes = (refspecs.length ? refspecs : [current]).map((r) => {
				const [source, target = source] = r.replace(/^\+/, "").split(":")
				return { source: deletes ? "" : source, target, forced: forced || r.startsWith("+") }
			})
			for (const { source, target, forced } of pushes) {
				if (target.includes("*")) {
					return "A pattern refspec can push `main`. Push one branch: `git push origin HEAD:main` to release (release skill), `git push -u origin HEAD` for a branch."
				}
				const name = target.replace(/^(refs\/)?heads\//, "")
				const toMain = name === "main" || (["HEAD", "@"].includes(name) && current === "main")
				if (!toMain) continue
				if (!source) return "Never delete `main`."
				if (forced)
					return "Never force-push `main`, nor rewrite a commit pushed to it. Fix forward."
				if (call.elsewhere || moved) {
					return "Push to `main` from the branch's own checkout, without `cd` or `git -C` on the same line: the hook checks the commit it can see (release skill)."
				}
				const problem = ship(["HEAD", "@"].includes(source) && current === "main" ? "main" : source)
				if (problem) return problem
			}
		}
	}
	return null
}

async function stdinJson() {
	let text = ""
	for await (const chunk of process.stdin) text += chunk
	return text ? JSON.parse(text) : {}
}

function refuse(reason) {
	if (!reason) process.exit(0)
	process.stderr.write(`${reason}\n`)
	process.exit(2)
}

async function main() {
	const [command, arg] = process.argv.slice(2)
	try {
		switch (command) {
			case "fingerprint":
				return console.log(fingerprint())
			case "mark-verified":
				return writeState("verified", arg || fingerprint())
			case "change-id":
				return console.log(changeId(arg || "origin/main"))
			case "mark-ci-passed":
				return arg ? writeState("ci-passed", arg) : undefined
			case "turn-start":
				return turnStart(arg)
			case "turn-end":
				return refuse(turnEnd(arg))
			case "guard":
				return refuse(guard(arg ?? ""))
			case "claude": {
				const event = await stdinJson()
				const session = event.session_id ?? "claude"
				if (event.hook_event_name === "UserPromptSubmit") return turnStart(session)
				// Claude Code sets stop_hook_active once a Stop hook has sent it back to work: ask once.
				if (event.hook_event_name === "Stop")
					return refuse(event.stop_hook_active ? null : turnEnd(session))
				if (event.hook_event_name === "PreToolUse")
					return refuse(guard(event.tool_input?.command ?? ""))
				return
			}
			default:
				process.stderr.write(`Unknown command: ${command}\n`)
				process.exit(1)
		}
	} catch (error) {
		// Fail open, but say why: a broken guardrail must not stop work, nor go unnoticed.
		process.stderr.write(`agent-hook ${command}: ${error.message}\n`)
		process.exit(
			["mark-verified", "mark-ci-passed", "change-id", "fingerprint"].includes(command) ? 1 : 0,
		)
	}
}

// Run as a script, not when a test imports it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main()
