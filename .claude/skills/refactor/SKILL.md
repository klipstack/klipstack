---
name: refactor
description: Changes the structure of Klipstack code without changing what it does, holding it to tests that pin the current behavior. Use when asked to refactor, clean up, restructure, simplify, deduplicate, rename, extract, move or split code, or to change an internal API, and before a feature when the code must change shape first.
---

# Refactor

The structure changes; the behavior does not. A bug you find on the way is a separate fix
(`fix-bug`). A behavior you want to add is a feature (`build-feature`). Note them and keep them
out of this change.

## 1. Pin the behavior first

- Find the tests that cover the code you will move: `rg` its exported names in `*.test.ts` and
  `apps/web/e2e/`. Run them, and see them pass.
- Where something is not covered, write the test before moving anything, through the public seam
  (the `write-tests` skill): the command, the route, the API. Break the code on purpose once, to
  see the new test fail.
- A typecheck and a lint pass are not a pin. They say the code compiles, not that it behaves the
  same.

## 2. Name the target shape

- Say what the code should look like if it were written today, and what gets simpler: fewer
  layers, branches, states or copies to keep in your head.
- Rules about user data end up in a command (`AGENTS.md`, "Commands"), not in an adapter.
- A shape that changes a public API (`/api/v1`, MCP, the SDK) is a behavior change: ask the owner
  first.

## 3. Subtract, then reshape

1. Delete first: dead code, one-caller wrappers, duplicate checks. Commit that on its own.
2. Move in small steps. Each one keeps the pinned tests green; run `pnpm verify` after each.
3. When an internal API changes shape, move every caller and delete the old one in this branch. No
   shims, and no old and new paths side by side.
4. After a rename, `rg` the old name. That includes strings, translation keys, docs and e2e specs.

## 4. Prove nothing changed

- The pinned tests pass without edits. A test you had to change means one of two things: either
  the behavior changed, or the test pinned internals. Say which in the report.
- Run `pnpm verify --full` when shared code moved (`packages/`, the test helpers).
- When the output can be compared, compare it before and after: an API answer, an extraction
  result, the page.

## 5. Keep it only if it is simpler

If the diff does not make the code easier to read, revert it and say so. A refactor is worth its
review cost only when the next person has less to hold in their head.

## Report

- What structure changed.
- The tests that pinned it, and which ones you added.
- The proof that behavior is unchanged.
- What got simpler.
- What you reverted, and any bug or feature you noted but left alone.
