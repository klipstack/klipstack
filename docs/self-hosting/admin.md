# Administration: roles, the operator CLI, release and rollback

Controls and tests: [docs/security.md](../security.md). Setting up a server: [README.md](README.md).

The commands below assume the example [compose.yml](compose.yml), run from its directory.

## Roles

Only the operator CLI grants or revokes the admin role. It needs database access, which whoever
runs the server has. There is no web endpoint, no email allowlist and no first-admin bootstrap: on
a new database nobody is an admin until someone runs it.

Run it inside the running web container (it has the CLI and the database URL):

```sh
docker compose exec web pnpm --filter @klipstack/web admin list
docker compose exec web pnpm --filter @klipstack/web admin grant --email <email> --reason "Initial operator"
docker compose exec web pnpm --filter @klipstack/web admin revoke --user-id <id> --reason "Access removed"
```

If web is down, start a throwaway container from the same image instead:

```sh
docker compose run --rm --no-deps web pnpm --filter @klipstack/web admin list
```

From a checkout of this repository with `DATABASE_URL` in `.env`, the same commands run without
Docker: `pnpm --filter @klipstack/web admin list`.

- Look the account up first (`admin list` shows current admins; account IDs are on `/admin/users`
  once one admin exists, or in the `user` table). A grant needs an existing, verified account
  with a password (set one in Settings, Account): the admin pages confirm a sign-in with it.
- Every change ends that account's browser sessions and writes an audit event with the actor
  `operator-cli`. The reason is context, not proof of who ran the command.
- Repeating a command reports "no change needed" and exits 0. A missing account, an unverified or
  passwordless grant, bad arguments or a failed transaction exit nonzero and change nothing.
- OAuth grants are not touched: they never carry admin authority.
- To switch admin access off, revoke every admin. Revoking the last one is allowed.
- The image ships this CLI only, and its build fails if the CLI cannot load. The invite CLI
  (`pnpm --filter @klipstack/web invite`) is not in the image: create invites on `/admin/invites`.

## Using /admin

- Reading needs the role, a verified email and a password on the account (an admin whose password
  was removed in the database is refused). Changes also need a sign-in from the last 30 minutes;
  after that, **Confirm it's you** asks for the signed-in account's password and renews the
  sign-in in place, without the login page. A refused change is never replayed.
- Limits per admin and hour: 20 invites, 60 revocations, 30 retries (60 retries across admins).
- `/admin/system` links to your uptime and backup dashboards when `OPS_UPTIME_URL` and
  `OPS_BACKUPS_URL` name them in `.env`. Only plain https dashboard URLs pass the environment
  check: never a URL with a secret in it, such as a monitor's heartbeat ping URL.
- The worker card shows process liveness only (a heartbeat every 30 s; stale after 90 s). The app
  has no last-backup time: backup status stays in your own monitoring. The same heartbeat feeds the
  public `/status` endpoint (see [README.md](README.md#reverse-proxy-and-tls)).
- Audit events are kept 90 days; the worker's daily purge (04:10 UTC) drops older ones and
  heartbeat rows of workers gone for 7 days. It also deletes expired sessions (with their IP
  address and browser) and expired sign-in, email-check and OAuth-state tokens.

## Wait list

`SIGNUP_MODE=waitlist` keeps sign-up invite-only and opens a public form at `/request-invite`.
Requests are answered on `/admin/requests`.

- Turn it on: set `SIGNUP_MODE=waitlist` in `.env`, then recreate the web container.
  `docker compose restart` keeps the old environment; `up` recreates a container whose settings
  changed:

  ```sh
  docker compose up -d web
  ```

- Turn it off: set it back to `invite` and recreate the web container the same way. Pending
  requests stay on `/admin/requests`.
- An image older than the wait list does not know `waitlist` and refuses to start. Before rolling
  back to such an image, set `SIGNUP_MODE=invite` first.
- The worker emails verified admins a digest at 08:00 UTC when new requests arrived. It needs
  `RESEND_API_KEY` and an admin address that receives mail. To send one now:
  `docker compose exec worker node --import tsx scripts/invite-digest-now.ts`.

## Stopping an account

There is no suspension. The one way to stop an account is to delete it, with everything in it:
its library, images, highlights, notes, feeds, editions (their public pages go with them), API
keys and connected apps. It cannot be undone, and there is no backup restore for one account.

**When.** Look before acting; nobody judges usage or private libraries by hand. The reasons the
terms give (`/terms#reports`): a serious or repeated breach. In practice:

- Illegal content on a public edition, especially material that harms children: delete at once,
  and report it to the authorities.
- Repeated removals: a second edition removed for spam, phishing or harassment
  (`/admin/reports`, "Removed editions"). The first removal is usually the warning.
- Getting around the limits: an account that keeps hitting a cap (`/admin/usage`, cap hits) and
  looks automated, or several accounts of one person.
- A credible complaint to your contact address, or a legal request.
- The account's own owner asks by email and can no longer sign in (a privacy request): delete it
  for them, after checking the request comes from the account's address.

**Before.** When it is reasonable, email the owner first: what breaks the terms, and that the
account will be deleted. Skip that for clearly illegal content.

**How.** Inside the running web container. `--confirm` must repeat the account's email: it guards
against deleting the wrong one. The reason goes into the audit (`/admin/audit`, "Account
deleted"); keep it short and factual, without personal data.

```sh
docker compose exec web pnpm --filter @klipstack/web admin delete-account \
  --email <email> --confirm <email> --reason "Phishing editions, removed twice"
```

- It runs the deletion Settings runs: stored images first, then every row, then the audit event
  in the same transaction.
- It refuses an admin's account: revoke the role first.
- Prints `<id>: deleted, with everything in it`. Exit code 1 with a message: nothing was deleted.
- Afterwards the address can sign up again only with a new invite. Don't send one.

## Two-factor authentication

Readers turn it on themselves, in Settings, Account: an authenticator app on their phone, and 10
backup codes shown once. Every new sign-in then asks for a code, whatever the way in (password,
emailed link, Google, GitHub, Apple, the iPhone app). While it is being tried out, only accounts
with the `two-factor` feature (`/admin/users/<id>`, Features in testing) can set it up; an account
that has it keeps it if the feature is turned off.

A reader who lost both the phone and the backup codes cannot sign in, and a password reset does
not help: it does not remove the second step. The operator CLI does.

**Before.** Make sure the request comes from the account's owner: a reply from the account's own
address, from a message you sent it, at least. Anyone can write claiming to have lost a phone, and
this command is what an attacker who stole the password would need.

```sh
docker compose exec web pnpm --filter @klipstack/web admin reset-two-factor \
  --email <email> --reason "Lost phone and backup codes; confirmed by reply from the address"
```

- It deletes the account's authenticator secret and backup codes, ends every session it has, and
  records an audit event (`/admin/audit`, "Two-factor authentication removed") in the same
  transaction. Connected apps keep their access.
- The reader then signs in without a code, and can set it up again.
- Prints `<id>: two-factor authentication removed; N session(s) ended`, or that it was not on.

## Release

A release is the upgrade in [README.md](README.md#upgrades-and-migrations): back up the database,
stop web and worker, run the migrations with the new image, then start both on it. Web and worker
must always run the same image.

On a new server, or the first time with an image that has the admin pages:

1. `admin list` (expect none), then grant your verified account, which has a password, by
   explicit email or ID.
2. Sign in afresh, open `/admin`, and check: overview counts, the worker shows "Seen recently",
   create and revoke a test invite, the audit page lists both and the grant.
3. With an ordinary account: no Admin menu entry, and `/admin` answers 403.

## The auth secret and OAuth signing keys

Better Auth encrypts the OAuth signing key (`jwks.private_key`) with `BETTER_AUTH_SECRET`. With a
different secret the key cannot be decrypted and `/api/auth/oauth2/token` answers 500: the CLI,
MCP clients and API tokens stop working, while browser sign-in does not show the problem. Do not
rotate the secret without a plan for that key (deleting the `jwks` row makes Better Auth create a
new one; tokens signed with the old key then no longer verify). Keep the secret with your backups:
a restored database needs it.

The same thing happens locally when e2e runs with a secret other than the one in `.env` against a
database that already has a `jwks` row: run OAuth specs (`api`, `mcp`, `oauth`) with the `.env`
secret.

## Rollback

Keep the schema. Never run a down migration: revocation history and audit rows must survive. Do
not roll back to an image from before the credential migration (migrations `0013` and `0014`; see
[docs/security.md](../security.md)).

To go back to an older image, set its tag in `.env` and recreate web and worker. Migrations are
written so that the previous release still runs on the newer schema. For example, with the admin
migration (`0015`) applied, an older image:

- keeps a revoked invite unusable: revoking also set `expires_at` five minutes into the past,
  which old signup code checks against the application's clock. The margin covers a clock that
  runs behind the database's. This covers invites that never expired before.
- still inserts invites from the old CLI: `invites.id` has a database default.
- ignores `user.role`, the audit table and the heartbeat table.

These cases are tested in `app/services/admin-invites.server.test.ts`, with the old signup
predicate and the old CLI insert.

An older worker can publish image results without checking their version. Before rolling back:

1. While the new image still runs, stop admitting image work: stop `web` first
   (`docker compose stop web`), so no save, retry or admin retry can queue more.
2. Let the new worker drain the queues. On `/admin/system` before step 1, or with
   `select name, state, count(*) from pgboss.job where state < 'completed' group by 1, 2`, wait
   until `extract` and `images` have no `created`, `retry` or `active` jobs.
3. Only then start the older image for both services: set its tag in `.env` and run
   `docker compose up -d`.

If the queues cannot be drained (a stuck job, time pressure), do not start the old worker on them:
roll back `web` only as an emergency measure and keep it short, or fix forward. A new producer
with an old worker is not a supported steady state; neither is the reverse.

Try a rollback on a copy of your data before relying on it.
