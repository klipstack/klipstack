// node --test scripts/*.test.mjs: the rules of scripts/agent-hook.mjs, which the hooks of Claude
// Code and Amp run.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, test } from "node:test"
import { fingerprint, guard, turnEnd } from "./agent-hook.mjs"

const script = join(import.meta.dirname, "agent-hook.mjs")

describe("guard", () => {
	const refused = (line, branch = "feat/x") => guard(line, process.cwd(), () => branch) !== null

	test("refuses commits on main, allows them on a branch", () => {
		assert.ok(refused("git add -A && git commit -m 'x'", "main"))
		assert.ok(refused("git -C . commit --amend", "main"))
		assert.ok(!refused("git commit -m 'merge main into the plan'"))
	})

	test("refuses pushes that reach main", () => {
		assert.ok(refused("git push origin main"))
		assert.ok(refused("git push origin HEAD:main"))
		assert.ok(refused("git push origin +main"))
		assert.ok(refused("git push origin feat/x:refs/heads/main"))
		assert.ok(refused("git push", "main"))
		assert.ok(refused("git push -u origin HEAD", "main"))
	})

	test("allows pushing a branch", () => {
		assert.ok(!refused("git push --force-with-lease -u origin HEAD"))
		assert.ok(!refused("git push origin feat/x", "main"))
		assert.ok(!refused("git fetch origin main && git rebase origin/main"))
	})

	test("refuses --no-verify and commit's -n", () => {
		assert.ok(refused("git commit --no-verify -m x"))
		assert.ok(refused("git commit -n -m x"))
		assert.ok(refused("git commit -anm x"))
		assert.ok(refused("git merge --no-verify feat/y"))
		assert.ok(refused("git -c core.hooksPath=/dev/null push --no-verify"))
		assert.ok(!refused("git commit -am 'no verify needed'"))
	})

	test("reads -n only where it means --no-verify", () => {
		assert.ok(refused("git commit -nm x"))
		assert.ok(refused("git commit --amend -n"))
		assert.ok(refused("git commit --no-veri -m x"))
		assert.ok(!refused('git commit -m "-n is a flag"'))
		assert.ok(!refused("git commit -mn"))
		assert.ok(!refused("git commit --amend --no-edit"))
	})

	test("follows a branch switch earlier on the same line", () => {
		assert.ok(!refused("git switch -c fix/x && git commit -m x", "main"))
		assert.ok(!refused("git checkout -b fix/x && git push -u origin HEAD", "main"))
		assert.ok(refused("git switch main && git commit -m x"))
		assert.ok(!refused("git checkout -- a.ts && git commit -m x"))
	})

	test("refuses pushing every branch, allows pushing tags", () => {
		assert.ok(refused("git push --all origin"))
		assert.ok(refused("git push --mirror origin"))
		assert.ok(!refused("git push origin --tags", "main"))
		assert.ok(refused("git push origin --delete main"))
	})

	test("refuses commits and merges onto main, not pulls", () => {
		assert.ok(refused("git merge feat/x", "main"))
		assert.ok(refused("git cherry-pick abc123", "main"))
		assert.ok(!refused("git pull --ff-only", "main"))
	})

	test("skips heredoc bodies and redirections", () => {
		const body =
			"gh pr create --body-file - <<'EOF'\nRun git push origin main to see it's done.\nEOF\n"
		assert.ok(!refused(body))
		assert.ok(refused(`${body}git push origin main`))
		assert.ok(refused("git push origin 2>&1", "main"))
		assert.ok(refused("git push origin >/tmp/push.log", "main"))
		assert.ok(!refused("git push origin feat/x 2>&1 | tail -1", "main"))
	})

	test("finds git behind shell keywords and wrappers", () => {
		assert.ok(refused("if git diff --quiet; then :; else git commit -am x; fi", "main"))
		assert.ok(refused("git add -A && { git commit -m x; }", "main"))
		assert.ok(refused("! git commit -m x", "main"))
		assert.ok(refused("for r in origin; do git push $r main; done"))
		assert.ok(refused("env FOO=1 git push origin main"))
		assert.ok(refused("sudo git push origin main"))
		assert.ok(refused("timeout 60 git push origin main"))
		assert.ok(refused("while read l; do :; done < <(git push origin main)"))
		assert.ok(refused("git \\\npush origin main"))
	})

	test("reads checkout of a path as restoring files, not switching", () => {
		assert.ok(refused("git checkout . && git commit -am x", "main"))
		assert.ok(refused("git checkout src/a.ts && git commit -am x", "main"))
		assert.ok(refused("git checkout main && git commit -m x"))
	})

	test("ends a heredoc only at its delimiter, and not inside arithmetic", () => {
		assert.ok(refused("cat <<EOF-X\nhi\nEOF-X\ngit push origin main"))
		assert.ok(refused("echo $((1<<2))\ngit push origin main"))
	})

	test("allows ordinary commands", () => {
		assert.ok(!refused("git commit -uno -m x"))
		assert.ok(!refused("git status 2>/dev/null || true", "main"))
		assert.ok(!refused("diff <(git show main:a) <(git show HEAD:a)", "main"))
		assert.ok(!refused("git log --oneline # what changed on main", "main"))
	})

	test("reads git commands, not text that mentions them", () => {
		assert.ok(!refused("echo git push origin main"))
		assert.ok(refused("GIT_TRACE=1 git push origin main"))
		assert.ok(!refused('echo "git push origin main"', "main"))
		assert.ok(!refused("git log main..HEAD", "main"))
		assert.ok(!refused("gh pr merge --squash --delete-branch", "main"))
		assert.ok(refused("cd apps/web && git push origin main"))
		assert.ok(refused("/usr/bin/git push origin main"))
	})

	test("reads the branch of the directory a git command runs in", () => {
		const branches = { "/repo": "main", "/repo/apps": "main", "/wt": "feat/x" }
		const refusedIn = (line, cwd) => guard(line, cwd, (dir) => branches[dir] ?? "") !== null
		assert.ok(!refusedIn("git commit -m x", "/wt"))
		assert.ok(refusedIn("git commit -m x", "/repo"))
		assert.ok(!refusedIn("cd /wt && git commit -m x", "/repo"))
		assert.ok(refusedIn("cd /repo && git commit -m x", "/wt"))
		assert.ok(refusedIn("cd apps; git push", "/repo"))
		assert.ok(!refusedIn("git -C /wt commit -m x", "/repo"))
		assert.ok(refusedIn("git -C /repo commit -m x", "/wt"))
		assert.ok(refusedIn("git -C /wt -C ../repo push -u origin HEAD", "/wt"))
	})

	test("keeps a cd in a subshell inside it", () => {
		const branches = { "/repo": "main", "/wt": "feat/x" }
		const refusedIn = (line, cwd) => guard(line, cwd, (dir) => branches[dir] ?? "") !== null
		assert.ok(refusedIn("(cd /wt && git status); git commit -m x", "/repo"))
		assert.ok(refusedIn("echo $(cd /wt && pwd) && git commit -m x", "/repo"))
		assert.ok(!refusedIn("(cd /wt && git commit -m x)", "/repo"))
	})
})

describe("in a worktree", () => {
	let root
	let main
	let worktree
	const git = (...args) => execFileSync("git", args, { stdio: "ignore" })
	// The hook may run in the main checkout; `cwd` names where the session works.
	const claude = (event) =>
		spawnSync(process.execPath, [script, "claude"], {
			cwd: main,
			input: JSON.stringify(event),
			encoding: "utf8",
		})
	const bash = (command, cwd) =>
		claude({ hook_event_name: "PreToolUse", tool_input: { command }, cwd })

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "agent-hook-worktree-")))
		main = join(root, "main")
		worktree = join(main, ".claude", "worktrees", "x")
		git("init", "-q", "-b", "main", main)
		git(
			"-C",
			main,
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@example.com",
			"commit",
			"--allow-empty",
			"-qm",
			"init",
		)
		git("-C", main, "worktree", "add", "-q", "-b", "feat/x", worktree)
	})
	afterEach(() => rmSync(root, { recursive: true, force: true }))

	test("allows a commit in a worktree on its own branch", () => {
		const result = bash("git commit -m x", worktree)
		assert.equal(result.status, 0, result.stderr)
		assert.equal(bash(`cd ${worktree} && git commit -m x`, main).status, 0)
		assert.equal(bash(`git -C ${worktree} push -u origin HEAD`, main).status, 0)
	})

	test("refuses a commit in the checkout on main", () => {
		const result = bash("git commit -m x", main)
		assert.equal(result.status, 2)
		assert.match(result.stderr, /Never commit on `main`/)
		assert.equal(bash(`cd ${main} && git commit -m x`, worktree).status, 2)
		assert.equal(bash(`git -C ${main} push`, worktree).status, 2)
	})

	test("reads the hook's own directory when the event names none", () => {
		assert.equal(bash("git commit -m x").status, 2)
	})

	test("asks for pnpm verify after a code change in the worktree, until it passes there", () => {
		const turn = { session_id: "w", cwd: worktree }
		claude({ ...turn, hook_event_name: "UserPromptSubmit" })
		writeFileSync(join(worktree, "a.ts"), "export const a = 1\n")
		const stop = claude({ ...turn, hook_event_name: "Stop", stop_hook_active: false })
		assert.equal(stop.status, 2, stop.stderr)
		assert.match(stop.stderr, /a\.ts/)
		execFileSync(process.execPath, [script, "mark-verified"], { cwd: worktree })
		assert.equal(claude({ ...turn, hook_event_name: "Stop", stop_hook_active: false }).status, 0)
	})
})

describe("turnEnd", () => {
	const cwd = process.cwd()
	let repo
	const git = (...args) => execFileSync("git", args, { stdio: "ignore" })
	const write = (file, text) => writeFileSync(join(repo, file), text)
	const hook = (...args) => execFileSync(process.execPath, [script, ...args])

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), "agent-hook-test-"))
		process.chdir(repo)
		git("init", "-q", "-b", "feat/x")
		write("a.ts", "export const a = 1\n")
		write("README.md", "# x\n")
		git("add", "-A")
		git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init")
	})
	afterEach(() => {
		process.chdir(cwd)
		rmSync(repo, { recursive: true, force: true })
	})

	test("passes a turn that changed nothing", () => {
		hook("turn-start", "t")
		assert.equal(turnEnd("t"), null)
	})

	test("passes a turn that changed only Markdown", () => {
		hook("turn-start", "t")
		write("README.md", "# a longer title\n")
		assert.equal(turnEnd("t"), null)
	})

	test("asks for pnpm verify when a turn changed code, until it passes", () => {
		hook("turn-start", "t")
		write("a.ts", "export const a = 22\n")
		write("b.ts", "export const b = 1\n")
		const reason = turnEnd("t")
		assert.match(reason, /a\.ts, b\.ts/)
		assert.match(reason, /pnpm verify/)
		hook("mark-verified", fingerprint())
		assert.equal(turnEnd("t"), null)
	})

	test("asks again after an edit that follows pnpm verify", () => {
		hook("turn-start", "t")
		write("a.ts", "export const a = 22\n")
		hook("mark-verified", fingerprint())
		write("a.ts", "export const a = 333\n")
		assert.match(turnEnd("t"), /a\.ts/)
	})

	test("passes a turn whose edits were undone", () => {
		hook("turn-start", "t")
		write("a.ts", "export const a = 4444\n")
		write("a.ts", "export const a = 1\n")
		assert.equal(turnEnd("t"), null)
	})

	test("keeps untracked files out of the repository's object store", () => {
		const looseObjects = () =>
			execFileSync("git", ["count-objects"], { encoding: "utf8" }).split(" ")[0]
		const before = looseObjects()
		write("big.bin", "x".repeat(1_000_000))
		hook("turn-start", "t")
		assert.match(turnEnd("t") ?? "", /^$/)
		write("big.bin", "y".repeat(1_000_000))
		assert.match(turnEnd("t"), /big\.bin/)
		assert.equal(looseObjects(), before)
	})

	test("without a turn start, compares with the last commit", () => {
		write("a.ts", "export const a = 22\n")
		assert.match(turnEnd("never-started"), /a\.ts/)
	})

	test("sees an edit of the same size in the same second as the commit", async () => {
		// Git trusts its cached file stats unless it knows the index is as new as the file. Whether
		// the edit lands in the commit's second is luck, so try a few times.
		const head = () =>
			execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim()
		for (const digit of [7, 8, 9]) {
			write("a.ts", `export const a = ${digit + 10}\n`)
			git("add", "-A")
			git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", `v${digit}`)
			write("a.ts", `export const a = ${digit + 20}\n`)
			await new Promise((resolve) => setTimeout(resolve, 1100))
			assert.notEqual(fingerprint(), head())
		}
	})

	describe("as a Claude Code hook", () => {
		const claude = (event) =>
			spawnSync(process.execPath, [script, "claude"], {
				input: JSON.stringify(event),
				encoding: "utf8",
			})

		test("sends Claude back once from a Stop after a code change", () => {
			claude({ hook_event_name: "UserPromptSubmit", session_id: "c" })
			write("a.ts", "export const a = 22\n")
			const stop = claude({ hook_event_name: "Stop", session_id: "c", stop_hook_active: false })
			assert.equal(stop.status, 2)
			assert.match(stop.stderr, /pnpm verify/)
			const again = claude({ hook_event_name: "Stop", session_id: "c", stop_hook_active: true })
			assert.equal(again.status, 0)
		})

		test("refuses a Bash command the guard refuses", () => {
			const event = {
				hook_event_name: "PreToolUse",
				tool_name: "Bash",
				tool_input: { command: "git push origin main" },
			}
			const result = claude(event)
			assert.equal(result.status, 2)
			assert.match(result.stderr, /Never push to `main`/)
		})

		test("fails open, saying why, outside a git repository", () => {
			const outside = mkdtempSync(join(tmpdir(), "agent-hook-outside-"))
			const result = spawnSync(process.execPath, [script, "claude"], {
				cwd: outside,
				input: JSON.stringify({ hook_event_name: "Stop", session_id: "c" }),
				encoding: "utf8",
			})
			rmSync(outside, { recursive: true, force: true })
			assert.equal(result.status, 0)
			assert.match(result.stderr, /agent-hook claude/)
		})
	})
})
