# Self-hosting Klipstack

This directory is for people who run their own Klipstack. It covers one machine with Docker
Compose: the containers, their settings, upgrades and backups.

- [compose.yml](compose.yml): an example Compose file for the web server, the worker and PostgreSQL.
- [admin.md](admin.md): roles, the operator CLI, stopping an account, release and rollback.
- [sign-in-providers.md](sign-in-providers.md): Google and GitHub sign-in.
- [ai.md](ai.md): AI answers in the reader, with an Anthropic key.
- [postgres-collation.md](postgres-collation.md): why the database uses the builtin collation
  provider, and how to move an existing database to it.

> **Known limitation:** the privacy policy, terms of use, support page and footers describe
> klipstack.com and its operator, Klipstack SpA, with its contact addresses. They are not yet
> configurable. Until they are, do not open a self-hosted instance to people other than yourself
> without replacing those pages with your own.

## What runs

| Part | What it does |
| --- | --- |
| `web` | The Node server: pages, the HTTP API, MCP and OAuth. Listens on port 3000 in the container. |
| `worker` | Background jobs (pg-boss): extraction, feeds, images, exports, emails, the daily purge. |
| `postgres` | PostgreSQL 17. Holds everything, the job queue too. |
| Image storage | Images of saved articles. A Docker volume (`STORAGE_DRIVER=fs`) or a private S3-compatible bucket (`STORAGE_DRIVER=s3`). |
| Email | Sign-in links, password resets, email verification, invite digests. Sent through [Resend](https://resend.com). |
| A reverse proxy | Yours: it ends TLS and forwards to the web container. Not in the Compose file. |

Web, worker and the one-off `migrate` run the same image. Web and worker must always run the same
version.

## The image

CI builds `ghcr.io/klipstack/klipstack` for `linux/amd64`:

- `:<sha>`: one tag per commit on `main`, the full 40-character commit hash.
- `:latest`: the newest image that passed its deploy.

Pin a `:<sha>` tag (`KLIPSTACK_IMAGE` in `.env`). With `:latest`, a `docker compose pull` can
change the version under you, and the migration step below would not run first.

To run your own build, from a checkout of this repository:

```sh
docker build --build-arg APP_VERSION=$(git rev-parse HEAD) -t klipstack:local .
```

Then set `KLIPSTACK_IMAGE=klipstack:local`. `APP_VERSION` is the commit shown in Settings.

The image runs as the `node` user (UID and GID 1000). Its default command is `node server.js` in
`/app/apps/web`. The worker runs `node --import tsx src/main.ts` in `/app/apps/worker`. Both run
under node directly, so `docker stop` reaches them and they shut down cleanly.

## Set it up

You need a machine with Docker and the Compose plugin, a domain name pointing at it, and ports 80
and 443 open for the reverse proxy. Give the worker at least 1.2 GB of memory: Compose limits it to
1200 MB, and image processing is sized to fit in that.

1. Make a directory, for example `klipstack/`, and copy [compose.yml](compose.yml) into it.
2. Create `.env` beside it, readable only by you (`chmod 600 .env`). Start from this; the
   [settings](#settings) below explain each line:

   ```sh
   KLIPSTACK_IMAGE=ghcr.io/klipstack/klipstack:<sha>
   POSTGRES_PASSWORD=          # openssl rand -hex 32
   BETTER_AUTH_SECRET=         # openssl rand -base64 48
   APP_URL=https://klipstack.example.com
   TRUST_PROXY=172.30.57.1
   SIGNUP_MODE=invite
   RESEND_API_KEY=
   EMAIL_FROM="Klipstack <hello@example.com>"
   STORAGE_DRIVER=fs
   ```

3. Start the database, create the schema, then start everything:

   ```sh
   docker compose up -d postgres
   docker compose run --rm migrate
   docker compose up -d
   docker compose ps          # web turns "healthy" within a minute
   ```

4. Put a reverse proxy with TLS in front of `127.0.0.1:3000` (see [below](#reverse-proxy-and-tls)).
5. Create the first account and make it an admin (see [below](#the-first-account-and-admin)).

## Settings

Compose reads `.env` twice: for its own variables (`KLIPSTACK_IMAGE`, `POSTGRES_PASSWORD`), and as
the environment of the app's containers. The web server checks its settings when it starts and
refuses to start with a wrong one: `docker compose logs web` says which.

### Required

| Variable | What it is |
| --- | --- |
| `POSTGRES_PASSWORD` | The database password. Compose builds `DATABASE_URL` from it, so use letters and digits only (`openssl rand -hex 32`). |
| `BETTER_AUTH_SECRET` | At least 32 characters (`openssl rand -base64 48`). It signs sessions and encrypts the OAuth signing key. Do not change it later: see [admin.md](admin.md#the-auth-secret-and-oauth-signing-keys). |
| `APP_URL` | The public address, with `https://` and no trailing slash. Links in emails, OAuth callbacks and the request-origin check use it. |
| `TRUST_PROXY` | Which address may send forwarding headers: your reverse proxy's. See [below](#reverse-proxy-and-tls). |

`DATABASE_URL` is set by the Compose file. To use a PostgreSQL server of your own instead, remove
the `postgres` service and the `DATABASE_URL` line from `compose.yml`, and set `DATABASE_URL` in
`.env`.

### Email

| Variable | What it is |
| --- | --- |
| `RESEND_API_KEY` | A [Resend](https://resend.com) API key. |
| `EMAIL_FROM` | The sender, for example `"Klipstack <hello@example.com>"`. Its domain must be verified in Resend. |

Without a key the server sends no email at all; it never prints sign-in links to the log. Password
login still works, but email links, password resets and email verification do not. Only a verified
account can become an admin, create API keys or connect apps, so without email you need Google or
GitHub sign-in ([sign-in-providers.md](sign-in-providers.md)): they verify the address themselves.

### Image storage

| Variable | What it is |
| --- | --- |
| `STORAGE_DRIVER` | `fs` (the default) or `s3`. An unknown value stops the server. |
| `S3_ENDPOINT` | With `s3`: the bucket service's S3 API endpoint, for example `https://<account>.r2.cloudflarestorage.com`. |
| `S3_BUCKET` | With `s3`: the bucket name. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | With `s3`: a key that can read, write and delete in that bucket. |
| `S3_REGION` | With `s3`: the region; `auto` (the default) for Cloudflare R2. |

With `fs`, images go to the `storage` volume, which web and worker share. That works on one
machine. Leave `STORAGE_FS_ROOT` unset: its default, `./storage`, is the volume's path,
`/app/storage`. With `s3`, the client uses path-style requests, so most S3-compatible services
work. Keep the bucket private: the app serves images itself, after checking who owns them.

### Optional

| Variable | Default | What it is |
| --- | --- | --- |
| `KLIPSTACK_IMAGE` | `ghcr.io/klipstack/klipstack:latest` | The image for web, worker and migrate (Compose only). |
| `SIGNUP_MODE` | `invite` | `invite`: sign-up needs an invite. `waitlist`: the same, plus a public form at `/request-invite`. `open`: anyone can sign up. See [admin.md](admin.md#wait-list). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Google sign-in. See [sign-in-providers.md](sign-in-providers.md). |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | unset | GitHub sign-in. |
| `ANTHROPIC_API_KEY` | unset | AI answers in the reader. See [ai.md](ai.md). |
| `TYPESAFE_API_KEY` | unset | With `ANTHROPIC_API_KEY`, automatic topics. See [ai.md](ai.md#automatic-topics). |
| `LIMIT_TOPICS_PER_MONTH` | `100` | Haiku's work on one account's topics per month. |
| `LIMIT_TOPIC_SORTS_PER_MONTH` | `1000` | Articles sorted into one account's topics per month, first sorts and re-sorts alike. |
| `LIMIT_SAVES_PER_MONTH` | `300` | Saves per account per month. |
| `LIMIT_STORAGE_MB` | `250` | Image storage per account. |
| `LIMIT_FEEDS` | `100` | Feeds per account. |
| `LIMIT_EDITIONS_PER_MONTH` | `4` | Editions per account per month. |
| `LIMIT_AI_PER_MONTH` | `100` | AI questions per account per month. |
| `LIMIT_AI_PER_MONTH_ADMIN` | `500` | AI questions per admin account per month. |
| `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID` | unset | Only with your own build of the iPhone app, signed by your Apple team: its team ID (10 characters) and bundle ID. With both set, `/.well-known/apple-app-site-association` lets that app open its sign-in callback (`/app/oauth/callback`) as a universal link; unset, it answers 404. Klipstack's own app works only with klipstack.com. |
| `PG_POOL_MAX` | `10` | Database connections per process (web and worker each have a pool). |
| `OPS_UPTIME_URL`, `OPS_BACKUPS_URL` | unset | Links on `/admin/system` to your uptime and backup dashboards. Plain `https` URLs only: no credentials, no query string. |

The limits apply to every account, admins too. The image sets `NODE_ENV=production`, `PORT=3000`
and `APP_VERSION`; leave them alone. `AI_FAKE` and `API_CHECK_RESPONSES` are for tests: never set
them on a real server.

## Reverse proxy and TLS

The web container speaks plain HTTP on `127.0.0.1:3000`. A reverse proxy on the same machine ends
TLS and forwards to it, with the `Host`, `X-Forwarded-For` and `X-Forwarded-Proto` headers.
[Caddy](https://caddyserver.com) does all of that and gets the certificate by itself:

```caddy
klipstack.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
```

`TRUST_PROXY` tells the server which address it may believe those headers from. It needs them for
two things: the request origin, which form posts are checked against, and the client's address,
which the sign-in rate limits count. Set it to the proxy's address as the container sees it:

- A proxy on the host, through the published port: the network's gateway, `172.30.57.1` with the
  example Compose file. The file fixes the subnet so that this address does not change.
- A proxy in a container on the same Compose network: that container's address. Give it a fixed
  one.

`TRUST_PROXY` takes an address, a subnet (`172.30.57.0/24`) or a comma-separated list. Unset, it is
`loopback`, which never matches inside a container. A wrong value has two symptoms: valid form posts
are refused, and every visitor shares one rate-limit address. Never trust a range that includes the
internet, and keep port 3000 closed to anything but the proxy: whoever can reach it directly could
claim any client address.

Two endpoints are for monitoring:

- `/healthcheck` answers `ok` when the web server can query the database. The Compose health
  check uses it.
- `/status` answers `ok`, or `degraded` with status 503 when background work stalls: no worker
  has reported recently, or a due job has waited ten minutes while its queue started nothing.
  Point an uptime monitor at it.

## The first account and admin

Sign-up is invite-only by default, and invites are made on `/admin/invites`, by an admin. To get
the first account in, create one invite in the database:

```sh
docker compose exec postgres psql -U klipstack -d klipstack -c \
  "insert into invites (code, note) values (upper(replace(gen_random_uuid()::text, '-', '')), 'First account') returning code"
```

Open `APP_URL/signup`, use the code, and verify the email address (from the email link, or by
signing up with Google or GitHub). Then make that account an admin with the operator CLI, inside
the running web container:

```sh
docker compose exec web pnpm --filter @klipstack/web admin grant \
  --email you@example.com --reason "First admin"
```

Sign in again: the grant ends the account's sessions. See [admin.md](admin.md) for the rest of
the CLI. A server only for yourself can also use `SIGNUP_MODE=open` while you sign up, then set it
back to `invite` and run `docker compose up -d web`.

## Upgrades and migrations

Every upgrade can change the database schema. Migrations are in the image and run with
`pnpm --filter @klipstack/db migrate`, which the `migrate` service runs. They must run before the
new web and worker start, and with the old ones stopped, so no old code writes during the change.

1. Back up the database (see [below](#backups)).
2. Set the new tag in `.env` (`KLIPSTACK_IMAGE=ghcr.io/klipstack/klipstack:<new sha>`), then:

   ```sh
   docker compose pull web worker
   docker compose stop web worker
   docker compose run --rm migrate
   docker compose up -d
   ```

3. Check `docker compose ps` (web healthy), `docker compose logs --tail 50 web worker`, and sign in.

What could go wrong:

- **The migration fails.** All pending migrations apply in one transaction, so a failure changes
  nothing. Put the previous tag back in `.env` and run `docker compose start web worker`: the
  stopped containers still have the old image, and they match the unchanged schema. Read the error
  before trying again.
- **A configuration error.** The new web stops at once and its log names the setting. Fix `.env`
  and run `docker compose up -d`.
- **Going back to an older image after a migration.** Never run a down migration. Read
  [admin.md](admin.md#rollback) first: some older workers must not run on newer queues.

The site is down from `stop` until web is healthy again: usually under a minute.
`migrate` also prints a warning when the database does not use the builtin collation provider (see
[postgres-collation.md](postgres-collation.md)).

## Backups

Everything worth keeping is in three places: the database, the images (the `storage` volume or
the bucket) and `.env`.

- **The database.** Dump it at least daily with `pg_dump`. A dump is consistent while the app
  runs:

  ```sh
  docker compose exec -T postgres pg_dump -U klipstack -Fc klipstack > klipstack-$(date +%F).dump
  ```

  Keep copies off the machine, encrypted, and delete old ones on a schedule.
- **Images.** With `fs`, back up the `storage` volume. With `s3`, rely on the bucket service, or
  copy the bucket elsewhere. Without them, restored articles lose their pictures.
- **`.env`.** Keep it in a password manager. A restored database needs the same
  `BETTER_AUTH_SECRET`: with another one, existing OAuth tokens, MCP clients and the CLI stop
  working.

A backup you have never restored is a hope. Now and then, restore the newest dump into a scratch
database created with the builtin provider, as in
[postgres-collation.md](postgres-collation.md#move-an-existing-database), and check the app starts
on it.

## PostgreSQL collation

The database must sort text with PostgreSQL's builtin provider, not the operating system's C
library: a library update in the PostgreSQL image could otherwise reorder text indexes and corrupt
them, without warning. The Compose file creates new databases that way. An existing database
created another way keeps its collation; [postgres-collation.md](postgres-collation.md) explains
how to check it and how to move it.
