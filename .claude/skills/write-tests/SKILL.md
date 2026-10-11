---
name: write-tests
description: How Klipstack's tests are written and what makes one worth keeping. Covers the real PostgreSQL, the harnesses for commands, routes, the API, MCP, workers and Playwright, and checking that a test can fail. Use when writing, changing or reviewing a test, and when a test fails and the question is whether the test or the code is wrong.
---

# Write tests that catch regressions

A test is worth keeping when it fails if the behavior it names breaks. Everything below serves
that.

## Where tests go and what they use

| Layer | Pattern | Example |
| --- | --- | --- |
| Command | Call it with a user ID against the real database. Assert the result, or the refusal (`rejects.toMatchObject({ code: "not_found" })`). | `apps/web/app/commands/annotations.server.test.ts` |
| Route loader or action | Import `loader` or `action`, call it with a `new Request(...)`. Usually only the session stands in: `vi.mock("~/lib/session.server", …)`, or real sessions from `app/test/admin-fixtures.ts`. | `app/routes/add.test.ts`, `app/routes/admin.routes.test.ts` |
| HTTP API, MCP | `app/test/api-harness.ts`: `apiUsers(tag)` makes users with API keys; `sdk`, `request` and `mcpClient` run the real routes in-process. `captured()` saves and extracts a fixture page. | `app/routes/api.v1.test.ts`, `app/routes/mcp.test.ts` |
| Worker job | Call the handler against the database. Mock only `notifyDocumentEvent`, partially. | `apps/worker/src/jobs/extract.test.ts` |
| Extraction | A captured page in `packages/extract/test/fixtures/pages/` and its entry in `manifest.ts`. | `packages/extract/test/fixtures.test.ts` |
| Browser | `apps/web/e2e/*.spec.ts`, using `signupUser`, `login`, `uniqueEmail` and `waitForHydration` from `e2e/helpers.ts`, and `insertArticle` from `e2e/seed.ts`. | `e2e/highlights.spec.ts` |

Tests use the database in `.env`, so give each test file its own data:
- IDs like `test-<tag>-${randomUUID()}`.
- The user inserted in `beforeAll` and deleted in `afterAll`, which cascades.
- Never rely on another test's rows or on the demo account.

## The bar

- **Assert outcomes**: the returned value, the row read back, the HTTP status and body, the text
  on the page.
  - Use exact values with `toEqual`, or `toMatchObject` on the fields that matter.
  - `toBeDefined`, `toBeTruthy` or `toHaveBeenCalled` alone pass for wrong results.
  - Quick test: would it still pass if the function returned `undefined` or an empty list? Then
    it asserts nothing.
- **Expected values are literals or come from the fixture**, never computed by the code under
  test.
- **Mock the process boundary, and little else**: the session, email, AI (`AI_FAKE`), network
  fetches, notifications.
  - Wrap the real module: `vi.mock(path, async (original) => ({ ...(await original()), fn }))`.
  - Never mock the database. A function that only reads or writes rows counts as the database:
    insert the rows the test needs instead.
  - Replace one function of our own code only to reach a path the real one can't reach in a
    test (a quota, a failure), or to see whether an expensive effect happened. Keep the rest of
    the module real. Write a comment that says what the replacement stands in for, and why the
    real one won't do.
  - Never mock the code whose behavior the test asserts.
- **Cover the refusals**, not only the success:
  - another user's item, a trashed item, a missing item: `not_found`
  - over a limit: `invalid_request`
  - rate limits
  - per-item outcomes in a batch
- **In Playwright, wait for a state whenever there is one**: `expect(…).toBeVisible()`, a
  response, a URL. Use role and label selectors.
  - A fixed `waitForTimeout` is right only in two cases. Say which in a comment, on the wait or
    at the start of its step:
    - to show that something did not happen (no reload, no toolbar);
    - when the product needs time to pass (the forms that refuse posts faster than a person
      types).
  - A fixed wait for something that will happen is a flaky test waiting to fail.

## See it fail once

Run every new test against code without the change, either by stashing the source and keeping
the test, or by breaking the code on purpose. It must fail, for the reason its name gives. A test
that has never failed has not been shown to test anything.

## Changing an existing test

- Change a test only when the behavior it pins changed on purpose. Say which test and why in the
  report.
- A failing test is a finding, not an obstacle. Find out whether the code or the test is wrong
  before touching either.
- Never commit `.skip`, `.only` or `.todo`.
- Read every line of a snapshot update (`vitest -u`) before keeping it.
- For a flaky test, find the race, shared data or clock behind it. Retries and longer timeouts
  hide it.
