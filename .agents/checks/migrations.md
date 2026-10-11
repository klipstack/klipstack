---
name: migrations
description: Database migrations keep data and deploy safely
severity-default: high
---

For changes under `packages/db/` (the schema and `drizzle/`), report:

- A migration that drops or rewrites data: `DROP TABLE`, `DROP COLUMN`, a type change that can
  fail or truncate, an `UPDATE` or `DELETE` over existing rows. These need the owner's agreement
  before the pull request (`AGENTS.md`), and the pull request must say so under Risk.
- A rename that drizzle-kit wrote as drop-and-add, which loses the column's data.
- A new `NOT NULL` column without a default or a backfill, on a table that has rows.
- An index on a large table created without `CONCURRENTLY` where a lock would block writes, or a
  long backfill inside the migration's transaction.
- A schema change without its generated migration and snapshot, or a migration edited after it
  was merged to `main`.
- A change the running version cannot survive. A deploy migrates first and restarts the app
  after, so for a moment the old web app and worker run on the new schema: a dropped or renamed
  column they still read breaks them. Split such changes: stop using it in one release, drop it
  in a later one.
