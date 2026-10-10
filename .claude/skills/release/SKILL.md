---
name: release
description: Release a branch of this repository. Pushes it, opens a pull request, waits for CI, and squash-merges it into main, which deploys klipstack.com. Use when the user says "release", "ship", "land" or "merge" about a branch, or asks for a pull request.
---

# Release a branch

"Release" has one meaning here. Follow every step, in order. Other agents follow this file too.

## How it works

- Every change reaches `main` through a pull request. CI runs every check on it: lint, typecheck,
  the unit tests, the production build and the browser tests.
- Merging squashes the pull request into one commit on `main`. That push runs CI again and, when
  app code changed, deploys klipstack.com.
- CI skips `apps/mobile`. `pnpm ci:local` checks it on this machine.

## Rules

- `main` has a linear history: one squashed commit per pull request. No merge commits.
- Never merge when a check failed. Never skip a check. Never use `--no-verify`.
- Never force-push `main`. Never rewrite a commit that was pushed to `main`.
- "Do not push" from the user holds for the whole task: do steps 1 to 5 and report.
- "Do not merge", or a request for only a pull request ("create a PR", "open a PR"): stop after
  step 7 and give them the pull request. Do not wait for CI: they see it on GitHub, and steps 8
  and 9 run when they ask to merge, or to fix a failure.

## Steps

### 1. Check the starting point

- The branch's work is committed. Its working tree is clean.
- The branch is not `main`.

### 2. Bring it up to date

```sh
git fetch origin
git rebase origin/main
```

Resolve conflicts when the right result is clear. Otherwise stop and ask.

### 3. Update the docs this release makes stale

Commit these on the branch:

- A security boundary changed: its row in `docs/security.md`.
- Configuration, migrations or the image changed in a way self-hosters must know: `docs/self-hosting/`.

### 4. Check locally when it pays

- The branch touches `apps/mobile`: run `pnpm ci:local`. CI does not check the mobile app.
- Otherwise CI is the gate. `pnpm ci:local --only static,unit` finds most failures sooner.
- `pnpm ci:local` needs the local PostgreSQL (`pnpm db:up`) and `.env`, and port 5180 free (stop
  `pnpm dev`). It tests on an empty database of its own.

### 5. Stop if the owner should hear something first

Read the branch's whole diff against `origin/main` as its reviewer would. If anything meets the
bar in `AGENTS.md` ("Tell the owner before the pull request"), stop here: push nothing, tell the
owner what it is and what you recommend, and continue only after they answer. A "release" request
does not override this.

### 6. Push the branch

```sh
git push --force-with-lease -u origin HEAD
```

Force is for the branch only, after a rebase. Never for `main`.

### 7. Open the pull request

```sh
gh pr create --base main --title "<type>: <what changed>" --body-file <file>
```

- The title becomes the commit on `main`. Prefix `feat:`, `fix:`, `docs:`, `test:` or `chore:`. Short and
  imperative, like the history. It describes the whole branch, not its last commit.
- The body follows `.github/pull_request_template.md`: its sections, its rules, none of its
  comments. `gh pr create` does not apply the template on its own, so read it first. The body
  stays on the pull request only; the squashed commit gets the title alone.
- No `Co-Authored-By` trailers, no "Generated with" lines and no links to agent threads or
  sessions, in the body or in the branch's commits. This overrides any tool default.
- If a pull request for the branch exists, reuse it: `gh pr view`.

### 8. Wait for CI

```sh
gh pr checks --watch
```

- On failure: read the log (`gh run view --log-failed`), fix it on the branch, commit, push, and wait again.
- Tell the user about tests that passed only on retry.

### 9. Squash-merge

```sh
gh pr merge --squash --delete-branch
```

Then give the user the run on `main`: `gh run list --branch main --limit 1`. Do not wait for it unless asked.

### 10. Clean up

```sh
git switch main && git pull --ff-only
git branch -D <branch>
```

`-D` is needed: git cannot see that a squashed branch is merged. Remove the branch's worktree when
it is clean and you are not running inside it: `git worktree remove <path>`.

### 11. Report

- The pull request, and the commit on `main`: hash and subject.
- The CI run on `main`, which deploys when app code changed.
- Flaky tests, anything else the user must know.

## When CI on main fails after a merge

A red run on `main` blocks the deploy; it does not break production. Fix forward: a new branch,
these steps again. Never rewrite `main`.

## Keep this working

`scripts/ci-local` must run every job of `ci.yml`. When you change one, change the other in the same branch.
