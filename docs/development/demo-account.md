# Local demo account

Build a reader account from real article captures, with a repeatable reading history. Run from
this repository with Node 22, dependencies installed, a migrated local PostgreSQL database, and
`STORAGE_DRIVER=fs` in `.env`. The web server and worker are not needed to generate the account.

```sh
pnpm db:up
pnpm db:migrate
pnpm demo:capture
pnpm demo:capture-feeds
pnpm demo:seed
pnpm --filter @klipstack/web dev
```

Sign in as **reader@demo.klipstack.test**, password **local-reader-only**. The account is a normal
reader named Alex Morgan. It has no admin privileges. Creation uses Better Auth's password format
without sending email or changing invite settings.

## Capture

`demo:capture` reads the tracked `apps/web/scripts/demo/reader-urls.txt`: one HTTP(S) URL per
line, with blank lines and `#` comments allowed. Add or remove URLs there to change the built-in
collection. The original `article-urls.local` stays gitignored; use `--urls article-urls.local`
for a private override. It normalizes and deduplicates URLs, fetches public pages with the application's
network protections, and uses the real extractors to find article content and images.

The gitignored `.demo.local/` directory contains:

- `captures/<url-hash>.json`: source and final URLs, capture date, extraction summary, page hash,
  image hashes, and image download failures.
- `blobs/<content-hash>.gz`: raw HTML and downloaded image bytes. Content hashes are checked on read.
- `capture-report.json`: the last capture run's successes and failures.
- `reader-<database-hash>.json`: the demo account's ownership record, fixed seed and date,
  document IDs, and completion checkpoints. Keep this file to seed or reset that account again.

The command reuses complete captures and retries missing pages. An interrupted run can be resumed
with the same command. Individual image failures are recorded; seeding uses the images available.
A page failure gives the capture command a nonzero exit code, but other captures remain usable.
The seed command reports missing pages and builds the available collection. Capture success means
extraction succeeded; inspect the library for truncated pages or publisher notices.

```sh
pnpm demo:capture --dry-run
pnpm demo:capture --limit 5
pnpm demo:capture --refresh            # explicitly fetch pages and images again
pnpm demo:capture --urls other-urls.local --cache .other-demo.local
```

Refresh replaces successful manifests atomically. A failed refresh retains the previous usable
capture and reports the failure. X posts are outside this profile.

## Feed snapshots

`pnpm demo:capture-feeds` reads `apps/web/scripts/demo/feed-urls.txt`. It discovers and captures
the five public feeds there, using the normal feed parser and network limits. It also captures
one of each feed's latest three articles as a working saved example. If an article cannot be
captured, it tries another; a feed can still be captured with no saved example. Raw feed data
lives in `.demo.local/feeds/` and the content-addressed blob cache. Nothing is added to the database
during capture.

```sh
pnpm demo:capture-feeds --dry-run
pnpm demo:capture-feeds --refresh
pnpm demo:capture-feeds --feeds my-feeds.local
pnpm demo:seed --feeds my-feeds.local
```

Seed and reset replay up to eight entries per feed without network access. Original titles,
excerpts, links, and publication dates are retained. New/seen times and dismissals are simulated.
The Computist Journal is the caught-up example: all its entries are dismissed. Other feeds have
new and previously seen posts, a dismissed entry, and a saved article where capture succeeded.
Seen examples use per-post views. Visiting the demo does not clear new posts; untouched posts
lose their New marker 14 days after their simulated availability date.
New saved examples are unread articles from the feed. Existing library articles keep their state.

Snapshots use private fixture rows with `feeds.demo.klipstack.test` identifiers and polling
scheduled outside the worker's range. Their site and article links still point to the real blogs.
They never reuse or modify another user's real feed row. Reset verifies ownership before removing
the fixture rows; it refuses if another account follows one. Exported demo OPML contains these
fixture identifiers and is not suitable for a real feed reader.

Missing feed captures are reported and skipped, so existing article-only workflows still work.
Repeated seeding preserves completed snapshots and manual changes. After refreshing a captured
feed, use `demo:reset` to apply it. Reset also ends existing sessions. Using Save on a new post in
the app uses the normal network extraction pipeline and needs the local worker; seeding does not.

## Seed, reset, and verify

```sh
pnpm demo:seed --dry-run
pnpm demo:seed --date 2026-09-22 --seed klipstack-reader-v1
pnpm demo:verify
pnpm demo:reset --dry-run
pnpm demo:reset                       # rebuild using the saved date and seed
pnpm demo:reset --date 2026-10-01      # move the history forward
```

The first seed saves its base date (today in UTC by default). URL-based choices remain stable when
other URLs are added or reordered. The profile includes unread and partly read articles, an
archive, stars, tags, notes, exact-text highlights, note links, saved searches, and recent trash.
Highlights are selected from real sentences inside paragraphs, with some two-sentence passages.
Finished articles get a target of 4–14 highlights (more for longer articles); partly read and
abandoned articles get 1–4, confined to the text already read. A coverage budget limits how much
of a short article is marked. Unread and trashed articles have no highlights. Selection, colors,
and dates use the saved seed, so resets reproduce the same passages. Duplicate quotes and
overlapping highlights are excluded.

Editorial hints in `apps/web/scripts/demo/profile.ts` keep meaningful passages and a few written
notes in selected articles. `scripts/demo/highlights.ts` adds the seeded passages throughout the
rest of the library. New profiles require `demo:reset` to update completed articles.

Seeding replays raw captures through the same extraction, version publication, search indexing,
outlink indexing, and image processing code used by the worker. It runs those steps directly and
creates no background jobs. It makes no network requests: unavailable images retain their alt
text, and cards use local thumbnails. For repeatable results, keep the corpus, source code,
dependencies, seed, and base date fixed. A changed capture requires a reset. Extractor changes
that discover uncached images require a capture refresh first.

`demo:seed` resumes incomplete work and adds newly captured articles. It leaves completed
articles alone, so it does not erase manual edits. `demo:reset` removes the owned demo account,
its data and image files, then recreates it. Existing sessions end. Both commands preflight the
corpus before account changes. Use the same `--cache` when running subsequent commands.

`demo:verify` reads the account, validates its credential, article versions, canonical text,
image bytes, every planned highlight and its anchor, dates, tags, notes, links, and search results. It prints counts and
a semantic fingerprint that ignores generated IDs. Repeated resets should give the same
fingerprint. It verifies the profile's initial state; reading or editing the demo can cause a
profile mismatch. Reset to restore that state. After a long interval, use a newer base date so
the worker's normal trash retention does not remove old fixture items.

## Scope and safeguards

Database commands refuse production mode, non-loopback database URLs, connection query overrides,
and S3 storage. An account is owned only when both its ID and email match the saved ownership
record. An email match alone never authorizes an overwrite. Deleting the ownership file does not
delete the account; restore the file before trying to manage that account again.

A database advisory lock prevents two demo commands from changing the same account concurrently.
If that account has pending worker jobs, let them finish before seeding or resetting. Do not use
the demo account in the browser during a reset. Other users and their files are outside the reset
scope. Keep the ownership record with the corresponding database and storage directory.

## Implementation and checks

The CLI is `apps/web/scripts/demo.ts`; cache, profile, replay, and verification code is beside it
in `scripts/demo/`. This is development tooling, with no schema changes or production demo routes.
The worker's publication transaction was extracted into `apps/worker/src/publish.ts` so replay
cannot drift from how real captures populate the database.

```sh
pnpm --filter @klipstack/web exec vitest run scripts/demo
pnpm --filter @klipstack/worker exec vitest run src/jobs/extract.test.ts src/jobs/images.test.ts src/images.test.ts
pnpm typecheck
pnpm lint
```

`scripts/demo/local.test.ts` checks the safety boundary: the CLI refuses a production or remote
database or storage, and never takes over an account whose email merely matches. It runs with the
web unit suite. Seeding, resets and replay have no automated test: after changing them, run
`seed --dry-run`, `seed`, `reset` and `verify` by hand and compare the fingerprints.
