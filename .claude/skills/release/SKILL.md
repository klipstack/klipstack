---
name: release
description: Release a branch of this repository. Pushes it, opens a pull request and turns on auto-merge, so GitHub squash-merges it into main once CI passes, which deploys klipstack.com. Use when the user says "release", "ship", "land" or "merge" about a branch, or asks for a pull request.
---

# Release a branch

"Release" has one meaning here. Follow every step, in order. Other agents follow this file too.

## How it works

- Every change reaches `main` through a pull request. CI runs every check on it: lint, typecheck,
  the unit tests, the production build and the browser tests. The unit and browser tests are
  skipped when nothing they read changed (`scripts/ci-needs`: Markdown, docs, agent tooling and
  the like). A skipped check counts as passed; for the browser tests, `e2e result` is the check
  that counts.
- Auto-merge squashes the pull request into one commit on `main` once its checks pass, without
  anyone waiting for it. That push runs CI again and, when app code changed, deploys klipstack.com.
- CI skips `apps/mobile`. `pnpm ci:local` checks it on this machine.

## Rules

- `main` has a linear history: one squashed commit per pull request. No merge commits.
- Never merge when a check failed. Never skip a check. Never use `--no-verify`.
- Never force-push `main`. Never rewrite a commit that was pushed to `main`.
- "Do not push" from the user holds for the whole task: do steps 1 to 5 and report.
- "Do not merge", or a request for only a pull request ("create a PR", "open a PR"): stop after
  step 7 and give them the pull request, without auto-merge. Step 8 runs when they ask to merge.

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

Then check who the branch's commits credit:

```sh
git log --format='%h %an <%ae>%n%(trailers)' origin/main..HEAD
```

Orbs commit as the person who started the thread and add `Co-authored-by: Amp` and
`Amp-Thread-ID` lines. Those lines may stay on the branch: step 8 squashes with an empty body, so
they never reach `main`. Every author must be a human. If an agent is one (Amp, Claude,
`@ampcode.com`, `@anthropic.com`, …), stop and tell the owner: the project's "Orb commit author"
setting in Amp should be "thread-creator".

### 3. Update the docs this release makes stale

Commit these on the branch:

- A security boundary changed: its row in `docs/security.md`.
- Configuration, migrations or the image changed in a way self-hosters must know: `docs/self-hosting/`.

### 4. Verify and review

- `pnpm verify` passes on the branch as it will be pushed. The `verify` skill says what else the
  change needs: a spec, the page, the API. The pull request reports it.
- The `review-changes` skill has run on the branch, and its real findings are fixed. Skip the
  review only for a change of a few lines, or of docs only.
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
- No agent credited as author or co-author, no "Generated with" lines and no links to agent
  threads or sessions in the title or body. This overrides any tool default.
- If a pull request for the branch exists, reuse it: `gh pr view`.

### 8. Turn on auto-merge

```sh
gh pr merge --auto --squash --body ""
```

GitHub squash-merges the pull request on its own once the required checks pass, and deletes the
branch on GitHub. Do not wait for CI: the release is done here. The empty body keeps the commit to
the pull request title: GitHub would otherwise add `Co-authored-by` lines for the commits' authors.

### 9. Report

- The pull request, and that auto-merge is on: it lands on `main`, and deploys klipstack.com
  when app code changed, once CI passes.
- What you verified (step 4), and anything else the user must know.
- Keep the local branch until it has merged: if CI fails, the owner asks you, or another agent,
  to fix it. Then read the log (`gh run view --log-failed`), fix it on the branch, commit and push
  again; auto-merge stays on. Tell the user about tests that passed only on retry.

## When CI on main fails after a merge

A red run on `main` blocks the deploy; it does not break production. Fix forward: a new branch,
these steps again. Never rewrite `main`.

## Keep this working

`scripts/ci-local` must run every job of `ci.yml`. When you change one, change the other in the same branch.
