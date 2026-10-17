---
name: verify
description: Proves a change to Klipstack works before anyone calls it done. It runs `pnpm verify`, then the proof that fits what changed (a test seen failing without the change, the page in a browser, the API's answer), and reports the evidence. Use before saying a task is done or fixed, before committing or opening a pull request, when a hook asks for `pnpm verify`, and when the user asks to check, test or prove a change.
---

# Verify a change

Done means proven by something you ran on this version of the code. Reading the code is not
proof, and neither is a passing typecheck: it says the code compiles, not what the user sees.

## 1. Run the fast check

```sh
pnpm verify          # lint, typecheck of affected workspaces, unit tests a change reaches
pnpm verify --full   # every unit test of the affected workspaces
```

It compares the working tree, commits and uncommitted files alike, with where the branch left
`origin/main`. It checks the migrations when `packages/db` changed. Its tests run on an
empty database of their own, on the local PostgreSQL, as in CI. Use `--full` after changing shared code such as
`packages/db`, `packages/api-contract` or the test helpers. Fix every failure and run it again.
It ends by listing what it cannot see, such as the UI or the mobile app. Do those next.

A failure in code your change does not touch is still a failure. Don't hide it, skip it, or fix it
silently in this branch. Show it in your report and say whether `main` fails the same way.

The hooks in `.claude/settings.json` and `.amp/plugins/` call `scripts/agent-hook.mjs`. If a turn
changed code and `pnpm verify` has not passed on the result, they send you back here, once.

## 2. Prove it where it shows

`pnpm verify` is the floor. Match the proof to what changed:

| What changed | Proof |
| --- | --- |
| A bug | A check that failed before the fix and passes after: the `fix-bug` skill. Show both runs. |
| A command or service (`app/commands`, `app/services`) | A Vitest test that calls it against the real database, as `app/commands/annotations.server.test.ts` does: the `write-tests` skill. |
| A route's loader or action | A test that calls it with a `Request` (`app/routes/*.test.ts`), then the page. |
| UI: components, routes, CSS, strings | The Playwright spec that covers it, added or extended. Then look at the page: [browser.md](browser.md). |
| HTTP API or MCP | `app/routes/api.v1.test.ts` or `app/routes/mcp.test.ts`, through `app/test/api-harness.ts`. Check error answers as well as success. |
| Database schema | `pnpm db:generate`, then read the SQL it wrote, then run `pnpm db:migrate` locally. A migration that drops or rewrites data goes to the owner first (AGENTS.md). |
| A worker job | Its test in `apps/worker/src/jobs/` calls the handler against the database. `pnpm dev` runs the real worker. |
| Extraction | A fixture in `packages/extract/test/fixtures` (`manifest.ts`). Read every line of a snapshot update. |
| A security boundary | The tests its row in `docs/security.md` names, and the row itself. |
| The extension | `WXT_APP_URL=http://localhost:5180 pnpm --filter @klipstack/extension build`, then `pnpm --filter @klipstack/web exec playwright test e2e/extension.spec.ts` |
| The mobile app | `pnpm ci:local`: CI skips it. Then use it in the simulator with real taps (`apps/mobile/tools/ui-driver`), on a throwaway account (`dev-account`), never the demo account. See `apps/mobile/AGENTS.md`. |
| `Dockerfile`, `server.js`, dependencies | `pnpm ci:local --only build,image` |
| Speed | Before and after numbers from the same machine, as the median of several runs, never an estimate. |

To run one spec:

```sh
pnpm --filter @klipstack/web exec playwright test e2e/<name>.spec.ts --project=chromium
```

Playwright reuses whatever answers on port 5180. Stop `pnpm dev` first, or set `E2E_PORT`.

## 3. Check that the proof can fail

A test that would pass without your change proves nothing about it. Run each new or changed
test once against the old behavior:
- Stash the source change and keep the test.
- Or break the code on purpose.

Then check that the test fails for the reason you expect.

## 4. Report the evidence

In your final message, and in the pull request's Verification section:
- What you ran and what it showed: commands, test names, screenshot paths, numbers.
- What you did not verify, and why. "Not verified" is an honest answer. A guess written as a fact
  is not.
- Say how you know each claim: you ran it (the command and its output), you traced it in the
  code (file and line), or you inferred it. Only the first is proof; label the others.

"Should work", "probably" and "looks right" mean nothing was checked. Run the check, or say it is
unverified.

Never make a check pass by weakening it. That means no skipping, deleting or loosening tests,
assertions, lint rules or types, and no `--no-verify`. A test that is wrong gets changed openly,
in its own commit, with the reason in the report.
