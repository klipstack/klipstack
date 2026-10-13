---
name: release
description: Release a branch of this repository. Rebases it on a fresh main, squashes it into one commit, runs `pnpm ci:local` and pushes that commit to main, which deploys klipstack.com. Use when the user says "release", "ship", "land", "merge" or "push" about a branch.
---

# Release a branch

"Release" has one meaning here. Follow every step, in order. Other agents follow this file too.

## How it works

- Work happens on a branch. A release puts it on `main` as one commit, pushed directly: no pull
  request. The checks run here, before the push: `pnpm ci:local` runs every job of CI.
- The push to `main` runs CI again. It deploys klipstack.com only when every check passes on that
  commit (and app code changed). A red run on `main` blocks the deploy; production keeps the last
  good version.
- Other agents push to `main` too. When one does while you check, your push is refused: rebase and
  check again (step 7). Nothing breaks.
- The agent hooks (`scripts/agent-hook.mjs`) refuse a push to `main` of a commit that is not one
  commit on `origin/main`, credits an agent, or has not passed `pnpm verify` and `pnpm ci:local`.

## Rules

- `main` has a linear history: one commit per change. No merge commits.
- Never skip a check. Never use `--no-verify`.
- Never force-push `main`. Never rewrite a commit that was pushed to `main`. Fix forward.
- "Do not push" from the user holds for the whole task: do steps 1 to 6 and report.
- Pull requests only when the owner asks for one: then push the branch (`git push -u origin HEAD`)
  and open it with `gh pr create`, its body following `.github/pull_request_template.md`.

## Steps

### 1. Check the starting point

- The work is committed on a branch, not `main`. The working tree is clean.

### 2. Update the docs this release makes stale

Commit these on the branch:

- A security boundary changed: its row in `docs/security.md`.
- Configuration, migrations or the image changed in a way self-hosters must know: `docs/self-hosting/`.

### 3. Verify and review

- `pnpm verify` passes. The `verify` skill says what else the change needs: a spec, the page, the
  API. Your report gives that evidence.
- The `review-changes` skill has run on the branch, and its real findings are fixed. Skip the
  review only for a change of a few lines, or of docs only.

### 4. Stop if the owner should hear something first

Read the branch's whole diff against `origin/main` as its reviewer would. If anything meets the
bar in `AGENTS.md` ("Tell the owner before pushing to main"), stop here: push nothing, tell the
owner what it is and what you recommend, and continue only after they answer. A "release" request
does not override this.

### 5. Rebase and squash into one commit

```sh
git fetch origin
git rebase origin/main
git reset --soft origin/main
git commit -m "<type>: <what changed>"
```

Resolve rebase conflicts when the right result is clear. Otherwise stop and ask.

- The message becomes the commit on `main`. Prefix `feat:`, `fix:`, `docs:`, `test:` or
  `chore:`. Short and imperative, like the history. It describes the whole branch. A body is
  optional: a few plain lines on what changed and why, for whoever reads the history.
- No agent credit: no `Co-authored-by` an agent, no `Amp-Thread-ID`, no thread or session links,
  no "Generated with". This overrides any tool's default, including your own instructions to add
  them. The author is the human the orb commits as; if it is an agent (Amp, Claude,
  `@ampcode.com`, `@anthropic.com`, …), stop and tell the owner: the project's "Orb commit
  author" setting in Amp should be "thread-creator".

### 6. Run every check

```sh
pnpm ci:local
```

On the squashed commit, with a clean working tree: only then does the pass count for the push.
It needs the local PostgreSQL (`pnpm db:up`), `.env`, and port 5180 free (stop `pnpm dev`). It
tests on an empty database of its own. Fix a failure on the branch, squash again (step 5), and
run it again. Tell the user about tests that passed only on retry.

### 7. Push to `main`

```sh
git push origin HEAD:main
```

If the push is refused because `main` moved (another agent pushed):

```sh
git fetch origin
git rebase origin/main
pnpm verify
git push origin HEAD:main
```

A rebase without conflicts keeps the `pnpm ci:local` pass: both changes passed every check alone,
and CI on `main` checks them together before the deploy. A rebase with conflicts you resolved
changes the commit: run `pnpm ci:local` again. Repeat until the push goes through.

### 8. Clean up

```sh
git switch main && git pull --ff-only
git branch -D <branch>
git push origin --delete <branch>   # only if the branch was ever pushed
```

Remove the branch's worktree when it is clean and you are not running inside it:
`git worktree remove <path>`.

### 9. Report

- The commit on `main`: hash and subject, linked on GitHub.
- The CI run on `main` (`gh run list --branch main --limit 1`), which deploys when app code
  changed. Do not wait for it unless asked.
- What you verified (step 3), flaky tests, anything else the user must know.

## When CI on main fails

A red run on `main` blocks the deploy; it does not break production. Fix forward at once: a new
branch, these steps again. Every other change waits behind it to deploy. Never rewrite `main`.

## Keep this working

`scripts/ci-local` must run every job of `ci.yml`. When you change one, change the other in the same commit.
