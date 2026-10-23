<p align="center">
  <a href="https://klipstack.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="brand/klipstack-logo-dark.svg">
      <img src="brand/klipstack-logo-light.svg" alt="Klipstack" width="320">
    </picture>
  </a>
</p>

<p align="center">
  <strong>Read it later, keep what matters.</strong><br>
  Save articles from anywhere, read them without clutter, and highlight and annotate what you want
  to remember.
</p>

<p align="center">
  <a href="https://klipstack.com"><strong>klipstack.com</strong></a> ·
  <a href="docs/self-hosting/README.md">Self-hosting</a> ·
  <a href="https://github.com/klipstack/klipstack/issues">Issues</a>
</p>

## Use Klipstack at klipstack.com

The easiest way to use Klipstack is at **[klipstack.com](https://klipstack.com)**: nothing to
install or run, with backups and upgrades taken care of. It's invite-only for now:
[request an invite](https://klipstack.com/request-invite).

## What it does

- **Save from anywhere.** The browser extension (Chrome, Firefox) saves the page as you see it, so
  paywalled and signed-in pages work too. Or share to the installed app, use the bookmarklet, or save
  from a script through the API.
- **Read without clutter.** Articles are extracted from their pages, images included, and Klipstack
  remembers where you left off. Posts and threads from X become readable articles too.
- **Highlight and annotate.** Mark passages, write notes in the margin, link notes to each other,
  and find every highlight again in one place.
- **Find it again.** Tags, saved searches, full-text search and a command palette.
- **Follow feeds.** Subscribe to RSS feeds and save the posts worth reading.
- **Share what you read.** Editions are public pages of the articles you found worth sharing.
- **On your phone.** Klipstack works in your phone's browser, offline too: the installable app
  keeps your inbox and starred articles readable without a connection. An iPhone app is coming
  soon.
- **Bring your tools.** An MCP server lets AI assistants search and annotate your library, and the
  HTTP API comes with a typed SDK.
- **Your data stays yours.** Export everything as Markdown and JSON at any time, or delete your
  account and everything in it.
- In English and Spanish.

## Self-hosting

Klipstack is open source, and you can run your own instance. Every commit on `main` publishes the
image `ghcr.io/klipstack/klipstack`; [docs/self-hosting](docs/self-hosting/README.md) runs it with
Docker Compose next to PostgreSQL, and covers configuration, upgrades, sign-in providers, AI and
the operator CLI.

## Development

Requirements: Node 22, pnpm 10, Docker.

```sh
cp .env.example .env
pnpm install
pnpm db:up          # Postgres 17 on localhost:5433
pnpm db:migrate
pnpm dev            # web on http://localhost:5180 + worker
```

Signups are invite-only by default (`SIGNUP_MODE=invite`). `SIGNUP_MODE=waitlist` also lets
visitors ask for an invite, which admins answer at `/admin/requests`. Create a code:

```sh
pnpm --filter @klipstack/web invite
```

### Demo account

Use real articles to build a repeatable local reader account:

```sh
pnpm demo:capture   # Cache the built-in reader article list
pnpm demo:seed      # Create the account offline, or resume an interrupted seed
pnpm demo:reset     # Restore its initial reading history from the cache
pnpm demo:verify    # Check data, images, highlights, search, and the profile fingerprint
pnpm demo:login-link # Print a one-time link that signs in to it
```

Sign in as `reader@demo.klipstack.test` with password `local-reader-only`. In an Amp orb,
`pnpm orb:app` builds and starts the app behind a portal with this account in place.
See [the demo account guide](docs/development/demo-account.md) for options and reset scope.

### Administration

`/admin` (invites, accounts, failed jobs, system status, audit trail) is for accounts with the
`admin` role. Only the operator CLI grants or revokes it; there is no web path and no automatic
first admin. The account must exist and have a verified email:

```sh
pnpm --filter @klipstack/web admin list
pnpm --filter @klipstack/web admin grant --email owner@example.com --reason "Initial operator"
pnpm --filter @klipstack/web admin revoke --user-id <id> --reason "Access removed"
```

Either change ends that account's browser sessions: sign in again afterwards. Admin changes need a
sign-in from the last 30 minutes. See the
[operator guide](docs/self-hosting/admin.md).

In development, emails print to the console unless `RESEND_API_KEY` is set. Production requires working email delivery; it never prints sign-in links to the console.

### Saving from outside the app

- **Browser extension** (`apps/extension`, WXT): `pnpm --filter @klipstack/extension build`, then load `apps/extension/dist/chrome-mv3` as an unpacked extension (Firefox: `build:firefox` → `dist/firefox-mv2`). It saves to https://klipstack.com, the only site it may reach; to save to another server, such as a dev server, build it for that one: `WXT_APP_URL=http://localhost:5180 pnpm --filter @klipstack/extension build`. It saves to the account you are signed in to in the same browser (no token). One click captures the rendered DOM, so paywalled and logged-in pages work.
- **HTTP API** (alpha): `/api/v1`, with `Authorization: Bearer <token>`, an OAuth access token for the `/api` resource (the CLI signs in with `klip auth login`). The OpenAPI document is at `/api/v1/openapi.json`; programs use the typed client in `packages/sdk`.
- **Save from a script**: `POST /api/v1/articles` with `Authorization: Bearer <token>` and JSON `{ "url": "…", "html": "<optional captured DOM>" }`. The browser's own `POST /api/documents` takes the session cookie only.
- **Bookmarklet**: on the Settings page.
- **Export**: Settings → Your data (zip of Markdown + JSON, or JSON).
- **Trash**: deleted articles sit in `/trash` for 30 days (restore, or delete forever). The worker purges older ones daily at 04:10 UTC and removes image files nothing references; `pnpm --filter @klipstack/worker purge` runs it now.

### Brand and icons

Source marks live in `brand/` ([brand/README.md](brand/README.md)).
Regenerate favicons, PWA icons, the iOS touch icon and both extension icon sets with:

```sh
pnpm --filter @klipstack/web icons
```

The web app is an installable PWA (`apps/web/public/manifest.webmanifest`): Android share sheets can send links to `/add` via the share target. A service worker (`apps/web/public/sw.js`) keeps the inbox and starred articles readable offline. Live updates (new saves, extraction finishing) arrive over server-sent events from `/api/events`, backed by Postgres `NOTIFY`.

### Checks

```sh
pnpm lint        # oxlint + oxfmt
pnpm typecheck
pnpm test        # vitest, all packages
pnpm test:e2e    # playwright (needs db + .env)
```

CI also boots the production bundle (`pnpm build` then `pnpm start`) and hits `/healthcheck`. The server bundle externalizes the runtime deps of `packages/*`, so any dep added to a package must also be declared in `apps/web/package.json` (the Vite config fails the build otherwise). A local end-to-end check of the image:

```sh
docker build -t klipstack:test .
docker run --rm --env-file .env -e DATABASE_URL=postgres://klipstack:klipstack@host.docker.internal:5433/klipstack -p 3001:3000 klipstack:test
```

### Layout

```
apps/web           React Router (framework mode, SSR): UI and resource routes
apps/worker        pg-boss worker: extraction, images, feeds, exports
apps/extension     Browser extension (WXT)
apps/mobile        iOS app (Expo), with a share extension
packages/db        Drizzle schema, migrations, client
packages/queue     pg-boss queue names, payloads, producer helper
packages/storage   Image storage: local files (dev) or S3-compatible
packages/log       Error logging that keeps user data, URLs and tokens out of the logs
packages/i18n      UI strings (en, es)
packages/extract   Fetching and article extraction
packages/anchor    Highlight anchoring
packages/ai        AI answers in the reader
packages/email     Emails
packages/api-contract  HTTP API endpoint definitions (zod), shared by the server and the SDK
packages/sdk       Typed client for the HTTP API
docs/self-hosting  Running your own Klipstack
docs/security.md   Security boundaries and their tests
```

[AGENTS.md](AGENTS.md) has the conventions: architecture, code style, tests and commands.

### Deploying klipstack.com

After the checks pass on `main`, CI pushes the image and asks the klipstack.com server to deploy it
through a restricted SSH account that accepts only that request. The server pulls the image, runs
migrations, and waits for health. The server's own configuration is kept elsewhere.

## Contributing

Klipstack does not accept code contributions for now, but bug reports and ideas are welcome as
issues: see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately:
[SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 Ernesto García. Klipstack is free software under the
[GNU Affero General Public License, version 3](LICENSE): you may use, change and share it, and if
you run a changed version as a network service, you must offer its source to the people who use it.
`packages/sdk` and `packages/api-contract` are under the MIT License, so programs that call the
Klipstack API can use them freely.

The license covers the code, not the Klipstack name or logo. Test fixtures, fonts and copied
third-party code keep their own terms. See [NOTICE](NOTICE).
