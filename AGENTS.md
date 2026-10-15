# Repository Guidelines

## Project Structure & Module Organization

Klipstack is a web app for saving, reading, and annotating articles, with a background worker and a browser extension.

- `apps/web/app/`: React Router SSR routes, components, and server services. Static assets live in `apps/web/public/`.
  Every change to user data is a command in `apps/web/app/commands/` (see "Commands" below).
- `apps/worker/src/jobs/`: pg-boss jobs for extraction, feeds, images, exports, and cleanup.
- `apps/extension/`: WXT browser extension; entry points are in `entrypoints/`.
- `apps/mobile/`: Expo (React Native) app for iOS, with a Swift share extension. See its
  `AGENTS.md`.
- `packages/`: shared database, queue, extraction, anchoring, storage, logging, email, AI, translations, API contract, and SDK code. Drizzle migrations live in `packages/db/drizzle/`.
- `brand/`: source artwork. `docs/security.md` lists the security boundaries and their tests.
- `docs/self-hosting/`: running Klipstack with Docker Compose, its configuration and operator CLI.

## Commands

Every change to a user's data has one implementation, a command, so the web app, the HTTP API
(`/api/v1`) and MCP cannot drift apart. Rules (limits, rate limits, ownership, the trash,
transactions) live in the command.

- **Adapters** (web route actions, `app/api/handlers`, `app/services/mcp`) parse the transport,
  call one command, and shape the answer. No rules of their own beyond the transport's.
- **Commands** (`app/commands/<domain>.server.ts`): `command(userId, input)`. They check the input
  against the limits in `@klipstack/api-contract`, apply rate limits, open the transaction, call
  services, and return plain data. A change to one item is a batch of one.
- **Services** (`app/services`) hold queries and row helpers. Writers take the transaction they run
  in (`tx: Db | Tx`). Adapters call services only to read.
- Every refusal is an `AppError` (`app/lib/app-error.ts`) with a contract `ErrorCode`, an English
  message and optional `details` and `retryAfter`; the status comes from the code. A missing,
  trashed or foreign item is `not_found`; input over a limit is `invalid_request`. In a batch,
  per-item outcomes (not found, already saved, refused) are part of the result, not errors.
- The API answers an `AppError` with `{error: {code, message, …}}`, web actions with
  `{ok: false, error: {…}}`, MCP with a tool error. Admin changes stay in
  `services/admin-*.server.ts` (checked and audited by `adminMutation`); sign-in stays with
  better-auth.

## Build, Test, and Development Commands

Use Node 22, pnpm 10, and Docker. Run commands from the repository root.

```sh
cp .env.example .env
pnpm install
pnpm db:up       # Start PostgreSQL on port 5433
pnpm db:migrate  # Apply migrations
pnpm dev         # Start web (localhost:5180) and worker
```

- `pnpm build`: create production builds.
- `pnpm lint` / `pnpm lint:fix`: check or fix lint rules (oxlint) and formatting and import order (oxfmt).
- `pnpm typecheck`: generate route types and check TypeScript across apps and packages.
- `pnpm test`: run Vitest tests across apps and packages.
- `pnpm verify` (`scripts/verify`): the fast check of a change, in a minute or two. It runs lint,
  the typecheck of affected workspaces, the migrations check, and the unit tests that a changed
  file reaches, on an empty database of its own. Add `--full` for every test of those workspaces.
- `pnpm test:e2e`: run Playwright; requires PostgreSQL, `.env`, and installed browsers. Each run
  deletes the accounts, invites, feeds and OAuth clients it created (`apps/web/e2e/cleanup.ts`,
  local databases only); `pnpm --filter @klipstack/web e2e:clean` removes leftovers of any age.
  Playwright reuses a server already on port 5180: stop `pnpm dev` first, or set `E2E_PORT`.
  `E2E_PROD=1` (after `pnpm build`) tests the production build, as CI does; the offline specs need it.
- `pnpm db:generate`: generate migrations after schema changes. CI fails when the schema has
  changes without one (`scripts/check-migrations`).
- `pnpm ci:local` (`scripts/ci-local`): run every job of `.github/workflows/ci.yml` (about ten
  minutes), on an empty database of its own. Stop `pnpm dev` first. `--only static,unit` runs a
  part. Change it and `ci.yml` together. CI skips `apps/mobile`; run this when a change touches it.
- `pnpm --filter @klipstack/extension dev`: develop the extension separately.
- `pnpm orb:app` (Amp orbs only): runs the app for a person to try, behind a portal, with the
  demo account (`reader@demo.klipstack.test`, password `local-reader-only`) in place. It prints
  the address and a one-time sign-in link to share. Run it again after changing code. It uses a
  database of its own, `klipstack_demo`, so it can keep running during `pnpm test:e2e`.
  `docs/development/demo-account.md` describes the account.
- When the user asks to run, open, try, see or demo the app or a change ("let me try it", "give
  me a link"), follow `.claude/skills/run-app/SKILL.md`.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. oxfmt owns formatting (tabs, 100 columns); run `pnpm lint:fix` rather than formatting by hand. Follow existing kebab-case filenames, PascalCase component names, and camelCase functions. Keep server-only web modules in `*.server.ts`. Update both English and Spanish strings in `packages/i18n/src/locales/`.

## Testing Guidelines

Use `*.test.ts` or `*.test.tsx` for Vitest tests beside source files; extraction tests also use `packages/extract/test/`. Place Playwright scenarios in `apps/web/e2e/*.spec.ts`. Add regression tests for behavior changes. Run focused tests with `pnpm --filter @klipstack/web test`, then relevant package and browser checks.

## Definition of Done

A change is done when something you ran shows it works. Reading the code is not enough. The skills
in `.claude/skills/` hold the how; follow the one that fits the task, without being asked:

- `verify`: before calling anything done. Run `pnpm verify`, prove the change where it shows (a
  test, the page, the API), and report what you ran, what it showed and what you did not verify.
- `fix-bug`: a check that fails on the bug before any fix, and passes after.
- `build-feature`: the owner's open decisions first, each with your recommendation. Then thin
  slices, test-first.
- `write-tests`: the real database, mocks only at the process boundary, every new test seen
  failing once.
- `review-changes`: when the owner says the work is ready for a pull request, or asks for a
  review, fresh subagents review the diff against the task and `.agents/checks/`.
- `learn`: when corrected, or when a mistake repeats, add a check, a test or a rule, not a
  promise.

Never make a check pass by weakening it: no skipped, deleted or loosened tests, and no
`--no-verify`. If a test is wrong, change it openly and say so in the report. Hooks enforce part
of this: they refuse commits on `main`, pushes to it and `--no-verify`. They also send an agent
back once when a turn changed code that `pnpm verify` has not passed. `docs/development/agents.md`
explains the setup.

## Commits, Branches and Releases

Every change reaches `main` through a pull request from a branch of its own; never commit on
`main`. A push to `main` runs CI and, when app code changed, deploys klipstack.com. "Release"
(also "ship", "land", "merge") means push, open a pull request and turn on auto-merge, which
squash-merges it once CI passes:
follow `.claude/skills/release/SKILL.md` step by step, whichever agent you are. It also holds the
rules for `main`.

- Commit messages and pull request titles use the prefixes `feat:`, `fix:`, `docs:`, `test:`, or
  `chore:` for work that is none of those. Short and imperative.
- Pull request descriptions follow `.github/pull_request_template.md`, without its comments.
- Never credit an agent on `main` or in a pull request's title or description: no agent (Amp,
  Claude or any other) as author or `Co-authored-by`, no "Generated with" lines, no links to agent
  threads or sessions (ampcode.com, claude.ai). Commits on `main` credit only the humans who did
  the work; crediting them, as author or `Co-authored-by`, is fine. This overrides any tool's
  default. A branch's commits may keep the `Co-authored-by: Amp` and `Amp-Thread-ID` lines orbs
  add: the squash-merge drops them. The release skill checks the branch's authors before pushing.

### Tell the owner before the pull request

The owner reviews every agent's work alone, and may not know what you found. Anything that should
not wait for review, tell them before opening the pull request, and stop there: do not open it
until they answer. You decide what clears that bar; when in doubt, ask. Typical cases:

- The change grew past what was asked, or falls short of it.
- A judgment call they might make differently: product or design behavior, a trade-off, a new
  dependency, a weakened check or test.
- Something you found that they may not know: a bug or risk elsewhere, a security or data concern,
  an instruction (theirs, a doc's, a tool's) that looks wrong or contradicts another.
- Something hard to undo: migrations that drop or rewrite data, public API behavior, deployment,
  CI or the server.

Say what it is, what you recommend, and what you need from them. Smaller notes go in the pull
request description.

## Configuration & Dependency Rules

Keep secrets in untracked `.env` files. When adding runtime dependencies to shared packages, also declare them in `apps/web/package.json`; the production server externalizes these dependencies and the build checks this requirement.

pnpm resolves only versions published at least 7 days ago (`minimumReleaseAge` in
`pnpm-workspace.yaml`), so a compromised release is usually pulled before it reaches us. When an
advisory's fix is newer than that, list the package in `minimumReleaseAgeExclude` to take it now,
and remove it once the version is a week old.

This repository is public. The klipstack.com server's configuration, runbooks and audits live in a
private repository; never add server names, addresses, bucket names, secret locations or other
details of that server here. Self-hosting docs use placeholders such as `example.com`.

The owner is new to operations work. When a task touches deployment, CI, backups,
monitoring or the server, explain it in plain terms: what each step does, why it matters, and
what could go wrong. Do this before asking them to run anything.
