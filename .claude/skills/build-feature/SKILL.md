---
name: build-feature
description: Builds a feature or behavior change in Klipstack end to end. It settles open decisions with the owner first, then delivers thin slices through the command, its adapters, the UI, both languages and the tests, each slice verified. Use when asked to add, change or build a feature, endpoint, page, setting or behavior bigger than a one-line change.
---

# Build a feature

## 1. Understand it, then settle what only the owner can decide

- Read the code the feature touches. Find the closest existing feature and how it is built, and
  follow it.
- Facts are your job: get them from the code, the docs and `git log`.
- Decisions are the owner's. That covers what users see and do, names and wording, limits, data
  that is kept or deleted, and anything hard to undo.
  - Ask them all in one message, numbered, each with your recommendation, so that "yes" accepts
    all of it.
  - Decide small, reversible choices yourself and list them in the pull request.
- Write down what done means: behaviors a user or API client can observe, each one checkable.
  "Works well" is not checkable. "A tag over 64 characters is refused with `invalid_request`" is.
- Write down what is out of scope.

## 2. Plan thin slices

- Each slice is a complete path that works and can be verified on its own: command and test,
  then its adapters, then the UI.
- Start with the riskiest unknown.
- If existing code must change shape first, do that in its own commit, with no change in behavior.

## 3. Put each part where it belongs

| The feature… | Then also |
| --- | --- |
| Changes user data | A command in `apps/web/app/commands/<domain>.server.ts`, as "Commands" in `AGENTS.md` describes. The web action, `app/api/handlers` and MCP only adapt it. |
| Takes new input | Its limits in `packages/api-contract` (`schemas.ts`, `names.ts`). Over a limit is `invalid_request`. |
| Changes the HTTP API | The contract in `packages/api-contract`, the SDK in `packages/sdk`, and `app/api/openapi.test.ts`. Tell the owner before a breaking change: clients depend on it. |
| Shows text | Both `en` and `es` in `packages/i18n/src/locales/`. The parity test fails if one is missing. |
| Changes the schema | `packages/db/src/schema`, then `pnpm db:generate`. Read the SQL it writes. |
| Touches a security boundary (sign-in, ownership, limits, sanitizing, sessions, admin) | Its row and tests in `docs/security.md`. A foreign or trashed item is `not_found`. |
| Needs configuration | `.env.example`, and `docs/self-hosting/` when self-hosters must act. |
| Runs in the background | A pg-boss job in `apps/worker/src/jobs/`. |
| Changes what the mobile app or extension calls | Check `apps/mobile` and `apps/extension` still work: the `verify` skill. |

## 4. Build each slice test-first

Work at the seam, usually the command:
1. Write the test for one behavior.
2. Run it and see it fail for the expected reason.
3. Write the least code that makes it pass, and run it again.
4. Move to the next behavior.

Test through the public seam with the real database (the `write-tests` skill). After each slice,
run `pnpm verify` and commit: one logical change per commit.

## 5. Finish

- Prove the whole feature where users meet it: its Playwright spec and the page (the `verify`
  skill).
- Check the result against the done list from step 1, one item at a time, and report any gap.
- When the owner says the work is ready for a pull request, review the diff (the
  `review-changes` skill).

Keep to the task. Unrequested features, refactors, renames and dependency upgrades belong in a
note in the report, not in this branch.
