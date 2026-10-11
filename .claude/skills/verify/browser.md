# Look at the change in a browser

A Playwright spec pins behavior. Looking at the page catches what specs don't assert: layout,
overflow, a missing string, a console error. Do both for UI changes. In an Amp orb, load the
`using-agent-browser` skill for the tool itself; this page covers Klipstack.

## Start the app

Sign-in checks `APP_URL`, so drive the app at the address it was started with.

- In an orb: `amp orb service start klipstack-dev --command "pnpm dev"` serves
  http://localhost:5180, the `APP_URL` of `.env`. Stop it with `amp orb service stop klipstack-dev`
  before running Playwright.
- Elsewhere: `pnpm dev`.
- `pnpm orb:app` is for the user. Its address is a portal that the browser here can't sign in to.

## Sign in as the demo reader

The demo account (`docs/development/demo-account.md`) has articles, highlights, tags, notes and
feeds. A one-time link signs in without the form:

```sh
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix verify)"
agent-browser set viewport 1280 800 2
agent-browser open "$(pnpm --silent demo:login-link --url http://localhost:5180)"
agent-browser get url            # http://localhost:5180/home when signed in
```

An orb has the account already. Elsewhere, `docs/development/demo-account.md` creates it. The form
login is `reader@demo.klipstack.test` / `local-reader-only`.

To start from an empty account, sign up a fresh one, as the e2e helpers do (`e2e/helpers.ts`,
`signupUser`). Never change the owner's data to test.

## Look

- `agent-browser snapshot -i` shows the page as roles and labels. Act on its `@e` refs.
- `agent-browser screenshot /tmp/<name>.png`, then open the image and look at it. Saving it is not
  looking.
- `agent-browser console` and `agent-browser errors`: no new errors or warnings from the change.
- Narrow screens: `agent-browser set viewport 390 844 2`. The app is used on phones.
- Spanish, when strings changed: the language in Settings. It wins over `?lng=es`, which works
  only when the account has none set. A long Spanish string is how overflow shows.
- The dark theme, when colors changed: Settings.
- Use the keyboard as a user would: Tab order, Escape, the shortcuts the change touches.

For each state the change affects, include empty, full, error and loading states. Check that the
screenshot shows the thing you claim it shows.

## Finish

- `agent-browser close`, and stop any service you started.
- Put screenshots the user should see in `.amp/in/artifacts/` in an orb, and link them in the
  report.
- Name each screenshot after what it shows, and add one line on what to look at.
