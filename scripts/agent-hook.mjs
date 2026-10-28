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
//                                             command that breaks a rule of AGENTS.md, when it
//                                             runs in the current directory
//   agent-hook.mjs mark-verified <tree>       record a tree `pnpm verify` passed (scripts/verify)
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
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
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

// Where a subshell starts and ends among the commands: a `cd` inside one stays inside it.
const subshellStart = ["("]
const subshellEnd = [")"]

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
			if (c === "(") result.push(subshellStart)
			if (c === ")") result.push(subshellEnd)
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

// `sudo FOO=1 cd dir` → ["cd", "dir"]: the program a command runs, and its arguments.
function program(words) {
	const i = words.findIndex((word) => !isPrefix(word))
	return i < 0 ? [] : words.slice(i)
}

// `FOO=1 git -C dir -c a=b push …` → { sub: "push", args: [...], dirs: ["dir"] }; null when the
// command is not git.
function gitInvocation(words) {
	const [name, ...rest] = program(words)
	if (name !== "git" && !name?.endsWith("/git")) return null
	const dirs = []
	let i = 0
	while (i < rest.length && rest[i].startsWith("-")) {
		if (rest[i] === "-C" && i + 1 < rest.length) dirs.push(rest[i + 1])
		if (["-C", "-c", "--git-dir", "--work-tree"].includes(rest[i])) i++
		i++
	}
	return i < rest.length ? { sub: rest[i], args: rest.slice(i + 1), dirs } : null
}

// The directory that `cd target` or `git -C target` leads to from dir. A target only the shell
// knows, such as a variable or `cd -`, is taken to leave dir as it is.
function chdir(dir, target = homedir()) {
	if (target === "-" || /[$`]/.test(target)) return dir
	return resolve(dir, target.replace(/^~(?=\/|$)/, homedir()))
}

const isBranch = (name, dir) => {
	if (!name || name === "-" || name.startsWith("-")) return name === "-"
	try {
		git(["-C", dir, "rev-parse", "-q", "--verify", `refs/heads/${name}`])
		return true
	} catch {
		return name === "main"
	}
}

const currentBranch = (dir) => {
	try {
		return git(["-C", dir, "symbolic-ref", "--short", "-q", "HEAD"])
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

// `cwd` is where the line runs, and `branchOf(dir)` stands in for git, for tests. A git command
// acts on the branch of the directory it runs in: a worktree's own, not that of the main checkout.
// The line is read in order: `cd wt && git commit` commits in wt, and `git switch -c x && git
// commit` commits on x.
export function guard(line, cwd = process.cwd(), branchOf = currentBranch) {
	let dir = resolve(cwd)
	const outer = []
	const switched = new Map()
	for (const words of commands(line)) {
		const [name, ...rest] = program(words)
		if (words === subshellStart) outer.push(dir)
		else if (words === subshellEnd) dir = outer.pop() ?? dir
		else if (name === "cd") {
			dir = chdir(
				dir,
				rest.find((arg) => !/^-./.test(arg)),
			)
		}
		const call = gitInvocation(words)
		if (!call) continue
		const { sub, args } = call
		const here = call.dirs.reduce((from, to) => chdir(from, to), dir)
		const current = switched.has(here) ? switched.get(here) : branchOf(here)
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
			if (sub === "checkout" && create < 0 && !isBranch(target, here)) continue
			if (target !== undefined) switched.set(here, target === "-" ? "" : target)
			continue
		}
		if (["commit", "merge", "cherry-pick", "revert", "am"].includes(sub) && current === "main") {
			return "Never commit on `main` (AGENTS.md). Create a branch first: `git switch -c <type>/<short-name>`; uncommitted changes come along."
		}
		if (sub === "push") {
			if (args.includes("--all") || args.includes("--mirror")) {
				return "`git push --all` or `--mirror` would push `main`. Push the branch: `git push -u origin HEAD`."
			}
			const refspecs = positionals(args, [
				"-o",
				"--push-option",
				"--repo",
				"--receive-pack",
				"--exec",
			]).slice(1)
			if (refspecs.length === 0 && args.includes("--tags")) continue
			const targets = refspecs.length
				? refspecs.map((r) => r.replace(/^\+/, "").split(":").pop())
				: [current]
			if (
				targets.some(
					(t) => t === "main" || t === "refs/heads/main" || (t === "HEAD" && current === "main"),
				)
			) {
				return "Never push to `main`: every change reaches it through a pull request (.claude/skills/release/SKILL.md)."
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
			case "turn-start":
				return turnStart(arg)
			case "turn-end":
				return refuse(turnEnd(arg))
			case "guard":
				return refuse(guard(arg ?? ""))
			case "claude": {
				const event = await stdinJson()
				const session = event.session_id ?? "claude"
				// `cwd` is where the session works, such as a worktree; this process may run elsewhere.
				if (event.cwd) process.chdir(event.cwd)
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
		process.exit(command === "mark-verified" || command === "fingerprint" ? 1 : 0)
	}
}

// Run as a script, not when a test imports it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main()
