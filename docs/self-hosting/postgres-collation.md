# PostgreSQL collation: the builtin provider

Klipstack's database must sort text with PostgreSQL's builtin collation provider. New databases
from the example [compose.yml](compose.yml), the repository's `docker-compose.yml` and CI are
created that way. This page explains why, how to check a database, and how to move an existing one.

## Why

A collation is the rule that orders text. A btree index stores text in that order. With the libc
provider (PostgreSQL's usual default), the rule comes from the operating system's C library
(glibc), and glibc changes it between versions.

So a database created under one glibc and then run under another, for example after the
`postgres:17` image was pulled again and the container recreated, can have every text index out of
order. PostgreSQL gives no warning. The damage shows later: a unique index lets duplicates in, and
in Klipstack the job queue (`pgboss.queue`) can hold duplicate keys, refuse to send jobs, and make
saving articles fail.

## The decision

Databases use the builtin provider with the `C.UTF-8` locale
(`--locale-provider=builtin --builtin-locale=C.UTF-8 --locale=C.UTF-8`).

- **Sorting** is by Unicode code point, implemented inside PostgreSQL. No OS or library update can
  change it, so it cannot corrupt an index. The PostgreSQL 17 docs
  ([locale](https://www.postgresql.org/docs/17/locale.html#LOCALE-PROVIDERS),
  [collation](https://www.postgresql.org/docs/17/collation.html)) say `C.UTF-8` "uses the code
  point values only".
- **Case mapping** (`lower`, `upper`, `ILIKE`) and regex classes use Unicode's simple rules,
  built into PostgreSQL. The docs call this "stable within a Postgres major version": a new major
  version may ship a newer Unicode. See [Major upgrades](#major-upgrades).
- **ICU was rejected** as the default: ICU collations change with the ICU library version, which
  the image's OS supplies. That is the same problem as glibc, one library over.
- **Plain `C` was rejected**: it is stable too, but `lower()` and `ILIKE` would only know ASCII.
  `ILIKE 'CAFÉ'` would stop matching `café`, and the case-insensitive tag names would treat
  "Árbol" and "árbol" as two tags.

What still depends on the OS: the full-text search parser decides what a word is with the libc
`LC_CTYPE` (`C.UTF-8`, from glibc). A change there could split a word differently in a new query
than in a stored search vector: a missed match, never a corrupted index.

## What changes for people

Text sorts by code point: uppercase before lowercase, accented letters after `z`. Where the order
shows, queries sort with ICU instead (`byName()` in `packages/db/src/collation.ts`, which adds
`collate "und-x-icu"`): tag lists, tag suggestions, tags in exports and on article cards, and
saved searches. An ICU collation in an `ORDER BY` is safe: nothing stores that order. Never index
with one.

No list sorts by title, author or site; feed lists sort in the app with `localeCompare`. `ILIKE`,
`unaccent` and full-text search behave as under libc. Emails and tokens compare for equality,
which no collation changes. Tag and saved-search names are unique by `lower()`, whose builtin
mapping may differ from glibc's for rare letters (see
[Check before moving](#1-check-before-moving)).

## Check a database

- `pnpm db:check-collation` fails when the database, or an index, sorts with a libc or ICU
  collation. CI runs it after the migrations, and so does `pnpm ci:local`. On a server, run it in
  the web container:

  ```sh
  docker compose exec web pnpm --filter @klipstack/db check-collation
  ```

  A good database prints `collation: stable (builtin provider)`.
- `pnpm db:migrate` (the `migrate` service) prints a warning for the same problems. It does not
  fail, so an existing libc database keeps working until you move it.

An existing volume keeps the collation it was created with: changing `POSTGRES_INITDB_ARGS` later
does nothing to it. Until you move a libc database, do not let the PostgreSQL image change under
it: pin the image you run by digest (`postgres:17@sha256:…`, from `docker inspect`) instead of the
`postgres:17` tag.

## Move an existing database

Dump the database, restore it into a new database created with the builtin provider, and swap the
names. The site is down for a minute or two on a small database. The commands assume the example
Compose file, run from its directory; the database is `klipstack`, and so is its user.

### 1. Check before moving

Run these with the app still up. Nothing changes.

Names that would collide under the builtin `lower()`, which would make the restore fail. Both
queries must return no rows; rename one tag or saved search of each pair if they do:

```sh
docker compose exec postgres psql -U klipstack -d klipstack -c \
  "select user_id, lower(name collate pg_c_utf8), count(*) from tags group by 1, 2 having count(*) > 1"
docker compose exec postgres psql -U klipstack -d klipstack -c \
  "select user_id, lower(name collate pg_c_utf8), count(*) from saved_searches group by 1, 2 having count(*) > 1"
```

Indexes already damaged under the current glibc. `amcheck` comes with PostgreSQL; the query stops
with an error at the first broken index:

```sh
docker compose exec postgres psql -U klipstack -d klipstack -c "create extension amcheck"
docker compose exec postgres psql -U klipstack -d klipstack -c \
  "select count(bt_index_check(c.oid)) from pg_index i join pg_class c on c.oid = i.indexrelid
   join pg_am a on a.oid = c.relam where a.amname = 'btree' and c.relpersistence <> 't'"
docker compose exec postgres psql -U klipstack -d klipstack -c "drop extension amcheck"
```

If an index fails, stop: the database may already hold duplicate rows that a damaged unique index
let in, and the restore would fail on them. Find and remove the duplicates, `reindex` the index,
and check again.

### 2. Move

```sh
docker compose stop web worker
docker compose exec -T postgres pg_dump -U klipstack -Fc klipstack > klipstack-before-builtin.dump
docker compose exec postgres psql -U klipstack -d postgres -c \
  "create database klipstack_builtin template template0 encoding 'UTF8' locale_provider builtin builtin_locale 'C.UTF-8' locale 'C.UTF-8'"
docker compose exec -T postgres pg_restore -U klipstack -d klipstack_builtin \
  --no-owner --exit-on-error --single-transaction < klipstack-before-builtin.dump
```

What each step does:

1. Stops the app, so nothing writes after the dump. The site is down from here.
2. Dumps the live database. Keep this file: it is also your backup.
3. Creates an empty database with the builtin provider.
4. Restores the dump into it, in one transaction: on any error nothing is left half-restored, and
   the live database is untouched. Start the app again (`docker compose start web worker`), read
   the error, and fix its cause first.

When the restore succeeds, swap the names and start the app:

```sh
docker compose exec postgres psql -U klipstack -d postgres -c \
  "alter database klipstack rename to klipstack_before_builtin"
docker compose exec postgres psql -U klipstack -d postgres -c \
  "alter database klipstack_builtin rename to klipstack"
docker compose start web worker
```

### 3. Verify

```sh
docker compose exec web pnpm --filter @klipstack/db check-collation
docker compose ps
docker compose logs --tail 50 web worker
```

`check-collation` must print `collation: stable (builtin provider)`. Then sign in, save an article
(this exercises the job queue), and open the tags page.

### Rolling back

If the app misbehaves on the new database, put the old one back. Anything written since the move
stays in the new database, renamed `klipstack_failed`, for recovery by hand:

```sh
docker compose stop web worker
docker compose exec postgres psql -U klipstack -d postgres -c 'alter database klipstack rename to klipstack_failed'
docker compose exec postgres psql -U klipstack -d postgres -c 'alter database klipstack_before_builtin rename to klipstack'
docker compose start web worker
```

The old database is libc again, so keep the image pinned.

### What can go wrong

| Problem | What happens | What to do |
| --- | --- | --- |
| A damaged index (step 1) | Duplicates may already be stored | Find and remove them, reindex, check again |
| Two tag names collide under the new `lower()` | Restore fails; live database untouched | Rename one, run the restore again |
| An extension the database user cannot create | Restore fails; live database untouched | Drop it if unused, or restore as a superuser |
| The dump is from before the app stopped | Last writes lost | Stop web and worker before the dump |
| The app does not start on the new database | Site down | Read the logs, or roll back |
| Disk full during the restore | Restore fails; live database untouched | Check free space first: the restore needs about the database's size again |

### After the move

- Drop the old copy after a few days of normal use:
  `docker compose exec postgres dropdb -U klipstack klipstack_before_builtin`.
- `template1` and the `postgres` database keep the old provider. They hold no app data, but a
  database created later with a plain `createdb` would inherit libc. To make builtin the default,
  rebuild `template1` from `template0`:

  ```sh
  docker compose exec postgres psql -U klipstack -d postgres -c 'alter database template1 is_template false'
  docker compose exec postgres psql -U klipstack -d postgres -c 'drop database template1'
  docker compose exec postgres psql -U klipstack -d postgres -c "create database template1 template template0 encoding 'UTF8' locale_provider builtin builtin_locale 'C.UTF-8' locale 'C.UTF-8' is_template true"
  ```

- Unpin the image back to `postgres:17`. With nothing ordered by glibc, a new image can no longer
  corrupt indexes, and pinning would only delay security updates. Keep the major version in the
  tag: a major upgrade is planned work.

## Major upgrades

Upgrade from 17 to 18 by dump and restore into a new server, as above: every index is rebuilt. If
`pg_upgrade` is ever used instead, reindex the indexes built on `lower()`, since a new major
version may update Unicode's case mapping:
`reindex index tags_user_name_unique; reindex index saved_searches_user_name_unique;`.

## Local databases

A new volume gets the builtin provider from `docker-compose.yml`. An existing volume keeps its
collation. To move a local database, dump it, create a builtin database, and restore into it:

```sh
docker exec klipstack-db-1 pg_dump -U klipstack -Fc klipstack > /tmp/klipstack.dump
docker exec klipstack-db-1 psql -U klipstack -d postgres -c 'create database klipstack_builtin template template0 encoding UTF8 locale_provider builtin builtin_locale "C.UTF-8" locale "C.UTF-8"'
docker exec -i klipstack-db-1 pg_restore -U klipstack -d klipstack_builtin --no-owner --exit-on-error --single-transaction < /tmp/klipstack.dump
```

Then rename the databases (with nothing connected) or point `.env` at the new one.
