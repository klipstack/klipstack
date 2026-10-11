---
name: tests
description: Tests prove the change and were not weakened to pass
severity-default: high
---

Report:

- A test removed, skipped (`.skip`, `.todo`, `test.fixme`), focused (`.only`) or made weaker: an
  assertion loosened (an exact value replaced by `toBeDefined`, `toBeTruthy`, `expect.any`), a
  case deleted, a timeout or retry raised, a check moved behind a condition. Unless the behavior
  it pinned changed on purpose and the change says so, this is the most serious finding.
- Changed behavior with no test that would fail without it: a new command, branch, limit or
  refusal; a bug fix with no regression test.
- A test that would pass if the code under test returned `undefined` or an empty list, or whose
  expected value is computed by the code under test.
- Mocks beyond the process boundary (the session, email, AI (`AI_FAKE`), network fetches,
  `notifyDocumentEvent`):
  - any mock of the database, including a function of ours that only reads or writes rows;
  - a mock of the code whose behavior the test asserts;
  - our own module replaced whole instead of wrapped.
  Replacing one function of our own code is fine when a comment says what it stands in for and
  why the real one won't do: a path it can't reach in a test, or an expensive effect the test
  needs to see.
- Tests that depend on each other's data, on the demo account, on wall-clock time or on order.
- A Playwright `waitForTimeout` where a state could be awaited. A fixed wait is fine only to show
  that something did not happen, or when the product needs time to pass, with a comment on the
  wait or at the start of its step saying which.
- A Playwright `goto` or `reload` followed by a click, key press or selection that needs the
  page's JavaScript (a button, a menu, a shortcut), with no `waitForHydration` between them. The
  server's page shows its content before the page hydrates, so assertions on it pass, while a
  click that lands before hydration does nothing; on a slow runner that is a flaky test. Links
  and plain form posts work without it.
- A Playwright test that saves an article and waits for the worker to extract it, when saving and
  extraction are not what it tests: `insertArticle` (`e2e/seed.ts`) puts it in place at once. A
  test that needs the extracted article (its real text and paragraphs) sets a `test.setTimeout`
  above its wait; a wait longer than the test's own timeout fails as a timeout, at random, on a
  slow first run.
- Refusals left untested: another user's item, a trashed item, input over a limit.
