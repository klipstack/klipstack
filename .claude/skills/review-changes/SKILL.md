---
name: review-changes
description: Reviews a branch's changes with fresh eyes before a pull request. Subagents that did not write the code check the diff against the task and against each check in .agents/checks/. The findings are then confirmed, fixed and verified again. Use when the owner says the work is ready for a pull request, asks to release it, or asks for a review. Not while the work is in progress.
---

# Review the changes

Whoever wrote the code shares its blind spots. Reviewers start fresh: they see the task and the
diff, and none of your reasoning.

Run it once the work is complete: when the owner says it is ready for a pull request, asks to
release it, or asks for a review. Each review costs several agent runs, so not after every
slice or commit. While you work, `pnpm verify` and the `verify` skill are the checks.

## 1. Brief the reviewers

The change is `git diff origin/main...HEAD` plus uncommitted work (`git diff HEAD`, untracked
files). Write a short brief:
- The task in the owner's words.
- What done means.
- The decisions you made and why.

Don't include your opinion of the code.

## 2. Run the reviews in parallel

Start one subagent for each review below. Each gets the brief, the diff commands and its own
instructions. Each reports findings as file and line, what is wrong, a concrete scenario where it
goes wrong, and a severity. "None" is a valid answer. Style that the linter owns is not a
finding.

The reviewers run at the same time in one working tree. Subagents see only their brief, not this
skill, so put this rule in every brief. The shared tree is read-only: no edits, no restores, no
`git stash`. A reviewer that wants to run or break code does it in a git worktree of its own,
and removes the worktree when done:

```sh
w=/tmp/review-<name>; git worktree add --detach "$w" HEAD
git diff HEAD | git -C "$w" apply                     # the uncommitted changes
git ls-files -z --others --exclude-standard | tar --null -T - -cf - | tar -xf - -C "$w"
cp .env "$w"/ && (cd "$w" && CI=true pnpm install --frozen-lockfile --offline)
# … experiment in "$w" …
git worktree remove --force "$w"
```

- **The task.** Does the diff do everything asked, and nothing more? Look for:
  - missing pieces
  - changes nobody asked for
  - behavior that looks finished but is wrong
  - unhandled cases: empty, at the limit, another user's item, a trashed item, two requests at
    once, Spanish, a phone screen
  - tests that would still pass if the feature broke
- **Each check in `.agents/checks/` whose subject the diff touches.** For example, `migrations`
  applies only when `packages/db/` changed, and `i18n` only when there is user-facing text. Two
  checks always apply: `tests`, and `public-repo`. Give the check file's text to its subagent as
  its instructions.

A change of a few lines needs only the task review and the checks it touches.

With no way to start subagents, do the reviews one after another yourself. Read the diff from the
start each time, with only that review's question in mind.

## 3. Confirm each finding before acting on it

Reviewers are wrong too. For each finding, either:
- reproduce it, with a test or a command, or
- trace it in the code until it is clearly real or clearly not.

Dismiss false ones with a one-line reason.

## 4. Fix, then verify again

- Fix the real findings and run `pnpm verify`. A fix to behavior gets a test (the `write-tests`
  skill).
- Review a large fix again, with only that fix in scope.

## 5. Record it

In the pull request's Verification section, say:
- that the review ran
- what it found and fixed
- what was dismissed, and why

A finding that meets the bar in "Tell the owner before the pull request" (`AGENTS.md`) goes to
the owner before the pull request is opened.
