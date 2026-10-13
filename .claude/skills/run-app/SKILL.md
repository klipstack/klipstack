---
name: run-app
description: Run Klipstack for the user to try, in an Amp orb, signed in to the demo account full of articles. Use when the user asks to run, start, open, launch, preview or demo the app, to try or see it or a change ("let me try it", "show me", "give me a link", "I want to click around"), or for a demo account or test login.
---

# Run the app for the user

The user wants to open Klipstack in their browser and use it. Other agents follow this file too.

## In an Amp orb (`AMP_ORB` is set)

1. Run `pnpm orb:app` from the repository root. The first run in an orb can take a few minutes
   (it creates the demo account when the orb has none); later runs take about ten seconds.
2. Share what it prints, as links: the portal address, and the one-time sign-in link, which opens
   the app signed in. Also give the login, `reader@demo.klipstack.test` / `local-reader-only`,
   which always works. Say the sign-in link works once, for 24 hours.
3. After changing code, run `pnpm orb:app` again: it rebuilds and restarts the app at the same
   address. Tell the user to reload the page.

Do not start `pnpm dev` for the user, set `APP_URL` yourself or create accounts of your own:
`pnpm orb:app` does all of it, and the demo account already has articles, highlights, tags, notes
and feeds. A new sign-in link: `DATABASE_URL=$(scripts/demo-database) pnpm demo:login-link --url <portal
address>` (the demo app has a database of its own, `klipstack_demo`). The app can keep running
while `pnpm test:e2e` runs: the tests use the database in `.env`.

If something fails, read `amp orb service logs klipstack-web` (or `klipstack-worker`). Run
`pnpm orb:app --reset` only when the user asks for a fresh demo account: it removes every change
made to the account.

## Elsewhere

`pnpm orb:app` refuses to run outside an orb. Follow "Build, Test, and Development Commands" in
`AGENTS.md` (`pnpm dev`, at http://localhost:5180) and create the demo account as
`docs/development/demo-account.md` describes.
