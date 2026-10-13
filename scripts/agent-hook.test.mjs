// node --test scripts/*.test.mjs: the rules of scripts/agent-hook.mjs, which the hooks of Claude
// Code and Amp run.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, test } from "node:test"
import { changeId, fingerprint, guard, shipProblem, turnEnd } from "./agent-hook.mjs"

const script = join(import.meta.dirname, "agent-hook.mjs")

describe("guard", () => {
	// A push to main goes through shipProblem, tested below; here it always finds a problem.
	const refused = (line, branch = "feat/x") => guard(line, branch, () => "not ready") !== null

	test("refuses commits on main, allows them on a branch", () => {
		assert.ok(refused("git add -A && git commit -m 'x'", "main"))
		assert.ok(refused("git -C . commit --amend", "main"))
		assert.ok(!refused("git commit -m 'merge main into the plan'"))
	})

	test("checks every push that reaches main", () => {
		assert.ok(refused("git push origin main"))
		assert.ok(refused("git push origin HEAD:main"))
		assert.ok(refused("git push origin +main"))
		assert.ok(refused("git push origin feat/x:refs/heads/main"))
		assert.ok(refused("git push", "main"))
		assert.ok(refused("git push -u origin HEAD", "main"))
	})

	test("allows a push to main that is ready, never a forced one or a deletion", () => {
		const ready = (line, branch = "feat/x") => guard(line, branch, () => null) === null
		assert.ok(ready("git push origin HEAD:main"))
		assert.ok(ready("git push origin main", "main"))
		assert.ok(!ready("git push --force origin HEAD:main"))
		assert.ok(!ready("git push --force-with-lease origin HEAD:main"))
		assert.ok(!ready("git push origin +HEAD:main"))
		assert.ok(!ready("git push origin --delete main"))
		assert.ok(!ready("git push origin :main"))
		assert.ok(!ready("git push -uf origin HEAD:main"))
		assert.ok(!ready("git push -fu origin HEAD:main"))
		assert.ok(!ready("git push -f origin HEAD:main"))
		assert.ok(!ready("git push -d origin main"))
	})

	test("finds main however the push names it", () => {
		assert.ok(refused("git push origin HEAD:heads/main"))
		assert.ok(refused("git push origin @", "main"))
		assert.ok(refused("git push origin 'refs/heads/*:refs/heads/*'"))
	})

	test("checks a push to main only from the checkout it runs in", () => {
		const ready = (line) => guard(line, "feat/x", () => null) === null
		assert.ok(!ready("git -C ../other push origin HEAD:main"))
		assert.ok(!ready("cd ../other && git push origin HEAD:main"))
		assert.ok(ready("cd ../other && git push -u origin HEAD"))
	})

	test("checks the commit that a push to main sends", () => {
		const sent = (line, branch = "feat/x") => {
			let rev
			guard(line, branch, (r) => {
				rev = r
				return null
			})
			return rev
		}
		assert.equal(sent("git push origin HEAD:main"), "HEAD")
		assert.equal(sent("git push origin feat/y:refs/heads/main"), "feat/y")
		assert.equal(sent("git push origin HEAD", "main"), "main")
		assert.equal(sent("git push -u origin HEAD"), undefined)
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
				tool_input: { command: "git switch main && git commit -am x" },
			}
			const result = claude(event)
			assert.equal(result.status, 2)
			assert.match(result.stderr, /Never commit on `main`/)
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

describe("shipProblem", () => {
	const cwd = process.cwd()
	let repo
	const git = (...args) =>
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim()
	const write = (file, text) => writeFileSync(join(repo, file), text)
	const hook = (...args) =>
		execFileSync(process.execPath, [script, ...args], { encoding: "utf8" }).trim()
	const commit = (file, text, message = "feat: x") => {
		write(file, text)
		git("add", "-A")
		git("commit", "-qm", message)
	}
	// What a full `pnpm ci:local` records (scripts/ci-local).
	const ciPassed = () => {
		hook("mark-verified", fingerprint())
		hook("mark-ci-passed", changeId("origin/main"))
	}
	// Another agent's push, then this branch rebased on it.
	const theirPush = (file, text) => {
		git("switch", "-q", "--detach", "origin/main")
		commit(file, text, "feat: theirs")
		git("update-ref", "refs/remotes/origin/main", "HEAD")
		git("switch", "-q", "feat/x")
		git("rebase", "-q", "origin/main")
	}

	const globalConfig = process.env.GIT_CONFIG_GLOBAL

	beforeEach(() => {
		// The developer's own settings (signing, rebase options) must not change what runs here.
		process.env.GIT_CONFIG_GLOBAL = "/dev/null"
		repo = mkdtempSync(join(tmpdir(), "agent-hook-ship-"))
		process.chdir(repo)
		git("init", "-q", "-b", "main")
		commit("a.ts", "export const a = 1\n", "init")
		git("update-ref", "refs/remotes/origin/main", "HEAD")
		git("switch", "-qc", "feat/x")
	})
	afterEach(() => {
		process.chdir(cwd)
		rmSync(repo, { recursive: true, force: true })
		if (globalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
		else process.env.GIT_CONFIG_GLOBAL = globalConfig
	})

	test("passes one commit that passed pnpm ci:local", () => {
		commit("b.ts", "export const b = 1\n")
		ciPassed()
		assert.equal(shipProblem("HEAD"), null)
	})

	test("refuses the push itself until the commit passed, as the hook runs it", () => {
		commit("b.ts", "export const b = 1\n")
		const push = () =>
			spawnSync(process.execPath, [script, "guard", "git push origin HEAD:main"], {
				encoding: "utf8",
			})
		assert.equal(push().status, 2)
		assert.match(push().stderr, /pnpm verify/)
		ciPassed()
		assert.equal(push().status, 0)
	})

	test("reads a change of any size", () => {
		commit("big.txt", `${"x".repeat(100)}\n`.repeat(30_000))
		ciPassed()
		assert.equal(shipProblem("HEAD"), null)
	})

	test("passes nothing to push", () => {
		assert.equal(shipProblem("HEAD"), null)
	})

	test("asks for pnpm verify and pnpm ci:local on the commit as it is", () => {
		commit("b.ts", "export const b = 1\n")
		assert.match(shipProblem("HEAD"), /pnpm verify/)
		hook("mark-verified", fingerprint())
		assert.match(shipProblem("HEAD"), /pnpm ci:local/)
		ciPassed()
		write("b.ts", "export const b = 2\n")
		git("commit", "-qam", "feat: x", "--amend")
		hook("mark-verified", fingerprint())
		assert.match(shipProblem("HEAD"), /pnpm ci:local/)
	})

	test("asks for pnpm ci:local again after a change of whitespace only", () => {
		commit("b.yml", "a:\n  b: 1\n")
		ciPassed()
		write("b.yml", "a:\nb: 1\n")
		git("commit", "-qam", "feat: x", "--amend")
		hook("mark-verified", fingerprint())
		assert.match(shipProblem("HEAD"), /pnpm ci:local/)
	})

	test("records what a full pnpm ci:local passed, and only that", () => {
		mkdirSync(join(repo, "scripts"))
		for (const file of ["ci-local", "agent-hook.mjs"])
			copyFileSync(join(import.meta.dirname, file), join(repo, "scripts", file))
		git("add", "-A")
		git("commit", "-qm", "chore: the scripts")
		git("update-ref", "refs/remotes/origin/main", "HEAD")
		const ciLocal = (...args) =>
			spawnSync("bash", ["scripts/ci-local", ...args], { encoding: "utf8" })
		// Only Markdown: the one change ci-local passes without pnpm, PostgreSQL or browsers.
		commit("notes.md", "# notes\n", "docs: notes")
		assert.equal(ciLocal("--only", "static").status, 0)
		assert.match(shipProblem("HEAD"), /pnpm verify/)
		write("draft.md", "# draft\n")
		assert.match(ciLocal().stdout, /uncommitted/)
		rmSync(join(repo, "draft.md"))
		hook("mark-verified", fingerprint())
		assert.match(shipProblem("HEAD"), /pnpm ci:local/)
		assert.equal(ciLocal().status, 0)
		assert.equal(shipProblem("HEAD"), null)
	})

	test("does not record a pnpm ci:local pass of uncommitted work", () => {
		commit("b.ts", "export const b = 1\n")
		write("c.ts", "export const c = 1\n")
		assert.equal(changeId("origin/main"), "")
	})

	test("asks for a rebase when origin/main moved", () => {
		commit("b.ts", "export const b = 1\n")
		ciPassed()
		git("switch", "-q", "--detach", "origin/main")
		commit("c.ts", "export const c = 1\n", "feat: theirs")
		git("update-ref", "refs/remotes/origin/main", "HEAD")
		git("switch", "-q", "feat/x")
		assert.match(shipProblem("HEAD"), /git rebase origin\/main/)
	})

	test("keeps a pnpm ci:local pass across a rebase, asks for pnpm verify again", () => {
		commit("b.ts", "export const b = 1\n")
		ciPassed()
		theirPush("c.ts", "export const c = 1\n")
		assert.match(shipProblem("HEAD"), /pnpm verify/)
		hook("mark-verified", fingerprint())
		assert.equal(shipProblem("HEAD"), null)
	})

	test("asks for a squash of more than one commit", () => {
		commit("b.ts", "export const b = 1\n")
		commit("c.ts", "export const c = 1\n")
		ciPassed()
		assert.match(shipProblem("HEAD"), /2 commits ahead/)
		git("reset", "-q", "--soft", "origin/main")
		git("commit", "-qm", "feat: b and c")
		hook("mark-verified", fingerprint())
		assert.equal(shipProblem("HEAD"), null)
	})

	test("refuses a commit that credits an agent", () => {
		for (const trailer of [
			"Co-authored-by: Amp <amp@ampcode.com>",
			"Amp-Thread-ID: https://ampcode.com/threads/T-1",
			"Co-Authored-By: Claude <noreply@anthropic.com>",
			"Generated with [Claude Code](https://claude.ai/code)",
		]) {
			git("reset", "-q", "--hard", "origin/main")
			commit("b.ts", "export const b = 1\n", `feat: x\n\n${trailer}`)
			ciPassed()
			assert.match(shipProblem("HEAD"), /credits an agent/, trailer)
		}
		git("reset", "-q", "--hard", "origin/main")
		write("b.ts", "export const b = 1\n")
		git("add", "-A")
		git("commit", "-qm", "feat: x", "--author", "Amp <amp@ampcode.com>")
		ciPassed()
		assert.match(shipProblem("HEAD"), /credits an agent/, "author")
		git("reset", "-q", "--hard", "origin/main")
		commit("b.ts", "export const b = 1\n", "feat: a sample generated with a script, for an example")
		ciPassed()
		assert.equal(shipProblem("HEAD"), null)
	})
})
