---
name: fix-bug
description: Fixes a bug in Klipstack by reproducing it first. It needs a check that fails on the reported symptom, then the root cause, then the smallest fix, then the same check passing. Use when something is broken, failing, throwing, wrong or slow, when the user reports a bug, a failing test or a red CI run, or asks to debug or diagnose a problem.
---

# Fix a bug

## 1. Reproduce it before anything else

Get a check that fails on the user's exact symptom, and run it. Pick the lowest layer that shows
the bug:
- A Vitest test on the command, service or route (the `write-tests` skill).
- A Playwright spec, when only the browser shows it.
- A command such as `curl`, `psql` or a short script.

The check must fail the same way on every run, within seconds, with no person in the loop. Keep
its output for the report.

If you can't make it fail, don't fix anything yet. Say what you tried and ask for what is
missing: the steps, the account's state, the browser, the logs.

For a red CI run, `gh run view --log-failed` shows what failed. Reproduce it locally with the
same command first.

## 2. Find the cause

- List the hypotheses that fit what the check shows. Test them one at a time, cheapest first.
- The cause is where the first wrong value appears, not where the program crashes.
- Tag temporary logs `[debug-<random>]`, so one `rg` finds them all before you commit.
- When the evidence rules a hypothesis out, revert what it made you change.

## 3. Fix the cause, in the smallest change

- A null check that hides a crash, a retry around a race or a broad `catch` treats the symptom.
  Use one only when the cause is outside this code, and say so.
- Search for the same mistake elsewhere (`rg` the pattern), and fix the copies the bug report
  covers.
- Mention the others in the report.

## 4. Prove it

1. Run the check from step 1. It passes now.
2. Undo the fix and run it again. It must fail; otherwise it does not test this bug.
3. Restore the fix.
4. Run `pnpm verify`.
5. The check stays, as the regression test.

## When fixes keep failing

After three fixes that didn't work, stop changing code: your model of the problem is wrong.
- Write down what you know and what you ruled out.
- Read the code path again from the entry point, or ask the owner.

## Report

- The symptom.
- The cause: file and line, and why it happened.
- The fix.
- The check's output before and after.
- Anything similar you found but left alone.

Put the cause in the commit message too.
