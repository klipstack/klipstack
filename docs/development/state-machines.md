# State machines

Klipstack's data has lifecycles: an article is read by the worker, translated, archived, trashed;
a topic is proposed, confirmed, retired. This page lists them, says which are written down as
explicit machines, and where the others live.

## Explicit machines

`packages/db/src/machines.ts` holds the lifecycles kept in a status column. Each machine lists the
column's states (from the schema) and every transition, each with the states it leaves (`from`) and
the state it writes (`to`).

| Machine | Column | States | Writers |
| --- | --- | --- | --- |
| `extractionMachine` | `documents.status` | queued, processing, ready, failed | `packages/queue/src/admission.ts`, `apps/worker/src/jobs/extract.ts`, `apps/worker/src/publish.ts`, `apps/worker/src/jobs/sweep.ts`, `apps/web/app/services/documents.server.ts` |
| `translationMachine` | `documents.translation_status` | null, pending, failed | `packages/queue/src/translation.ts`, `apps/worker/src/jobs/translate.ts` |
| `topicMachine` | `topics.status` | proposed, active, retired, removed | `apps/worker/src/topics.ts`, `apps/web/app/commands/topics.server.ts` |

```text
extraction   save ──► queued ──start──► processing ──publish──► ready
                        ▲  ▲                │ │                   │
                        │  └──retryLater────┘ └──fail──► failed   │
                        └────────── capture / refresh / retry ◄───┘ (retry: failed only)
                        keep: queued|processing ──► ready (a failure that has a readable version)
                        start also runs from processing, ready or failed (a job run again, or raced by the sweep)

translation  null|failed ──request──► pending ──finish──► null
                                          └────fail─────► failed
             null|failed ──reuse──► null (a translation made before, shown again)

topic        propose ──► proposed ──confirm──► active ──retire──► retired
                            └──reject──► removed ◄──remove──┘
             grow ──► active
```

### Rules

- A writer sets a transition's `to`, never a literal:
  `.set({ status: extractionMachine.transitions.publish.to })`. `pnpm lint` refuses a literal
  (`klipstack/status-through-machine`, in `scripts/oxlint-plugin.mjs`), so searching for
  `transitions.publish` finds every writer of that move.
- A new move is a new transition in `machines.ts` first, with a comment that says when it
  happens. `machines.test.ts` fails when a state can't be reached.
- `from` documents the moves the running system makes. The writer's own guards enforce them: the
  row lock in admission, `where status = 'processing'` in the worker. `can(machine, event, state)`
  asks the same question in code. The moves were written down as they are, with no behavior
  changed.
- The rule reads Drizzle's `.set()`, `.values()` and `onConflictDoUpdate`, for a literal or a
  choice between literals. It does not follow a status passed in a variable or a spread.
  Hand-written SQL (the sweep) uses the machine's values as parameters by convention. Test
  fixtures, e2e specs and seed scripts (`apps/web/scripts`) write literals on purpose and are
  not checked.

## The extension's save

The browser extension keeps no rows: each tab's save is a status in the background's memory.
`apps/extension/lib/save-flow.ts` holds it as a union (`TabStatus`: idle, starting, saving,
signingIn, saved, failed) and a pure `transition(status, event)`, unit-tested in
`save-flow.test.ts`. The background (`entrypoints/background.ts`) dispatches events and draws the
toolbar badge and the in-page toast from the status a tab enters; nothing else sets them.

```text
idle|saved|failed|signingIn ──clicked──► starting ──sending──► saving ──answered──► saved|failed
starting ──refused──► failed           starting|saving ──signInNeeded──► signingIn
signingIn ──signInFailed──► failed     signingIn ──signInAbandoned──► idle
saved|failed ──faded (2.5 s)──► idle   starting|saving ──clicked──► same (one save per tab)
```

The sign-in the extension opens (Safari's build) is one at a time, in `storage.local` (`signIn`):
its tab, its PKCE verifier and state, and the saves waiting for it.
`lib/background.test.ts` runs the background through its listeners with a fake browser and server.

## Lifecycles still implicit

These are encoded as nullable timestamps, often with more than one column. The timestamps carry
the time as well as the state, and readers filter on them in SQL. A status column would need a
migration and would change the API, so they stay as they are. Their rules live in the command
that writes them.

| Lifecycle | Columns | Writes |
| --- | --- | --- |
| Inbox, archive, trash | `documents.archivedAt`, `deletedAt` | `apps/web/app/commands/articles.server.ts`, `services/documents.server.ts` (restore), `apps/worker/src/jobs/purge.ts` |
| Reading | `firstOpenedAt`, `readAt`, `lastReadAt`, `readingProgress`, `readingCycle`, `reading_completions` | `commands/articles.server.ts`; "finished" is `READ_PROGRESS` in `lib/inbox-filters.ts` |
| Editions | `publishedAt`, `republishedAt`, `unpublishedAt`, `removedAt` | `commands/editions-actions.server.ts`, `services/editions-write.server.ts`, `services/admin-reports.server.ts`; `editionState()` in `apps/web/app/lib/editions.ts` |
| Highlight shares | `published`, `removedAt` | `commands/highlight-shares.server.ts`, `services/admin-reports.server.ts` |
| Topic library | `topicLibraries.proposedAt`, `seenAt`, `confirmedAt`, … | `commands/topics.server.ts`, `apps/worker/src/topics.ts` (`run`) |
| Invites | `usedAt`, `expiresAt`, `revokedAt` | `lib/invites.server.ts`, `services/admin-invites.server.ts` |
| Feed fetching | `nextFetchAt`, `errorCount`, `lastSuccessAt` | `apps/worker/src/jobs/feeds.ts` |
| Images | `documentVersions.imagesDone` | `packages/queue/src/admission.ts`, `apps/worker/src/jobs/images.ts` |

## Known gaps

Found while writing the machines down, and left as they are because fixing them changes
behavior:

- The worker starts extraction (`start`) with no status guard (`extract.ts`), and it does not
  check `deletedAt` again.
- A failure kept as `ready` (`keep`) leaves its `failureReason` set; the API shows it only for
  `failed`.
- `translationStatus: failed` stays after "Use original" and new captures; a translation
  superseded by a newer capture is also recorded as `failed`.
- Retiring a topic has no status guard in its update. Its callers pick active topics.
- The web client counts an article as finished on `readAt` alone; the server also counts
  `readingProgress >= 0.95`.
- `editionState()` has no `removed` state, and "live edition" is checked three different ways.
- `noteSkippedAt` is not cleared when an article is read again.
