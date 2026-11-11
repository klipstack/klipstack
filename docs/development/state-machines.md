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

## The web client's flows

Some of the web app's interactions are written the same way: a union and a pure `transition`,
unit-tested beside it, held in a ref for event handlers and in state for rendering.

| Flow | File | States |
| --- | --- | --- |
| Resizing a highlight | `apps/web/app/lib/highlight-resize-flow.ts` (`hooks/use-highlight-resize.ts` runs it) | idle, pointer, keyboard, saving, failed (waiting for the refresh, then retryable) |
| Pull to refresh | `apps/web/app/components/pull-to-refresh.tsx` | idle, pulling, refreshing |

```text
resize   idle ──begin──► pointer|keyboard ──sent──► saving ──answered──► idle
                              └──cancelled──► idle          └──(error)──► failed
         failed ──refreshed──► failed (retryable) ──sent (retry)──► saving
                                                  ──begin──► pointer|keyboard
                                                  ──settled──► idle (saved after all, or nothing to retry)
```

A failed resize starts nothing, neither a retry nor a new resize, until the highlights have
loaded again: `revalidate()`'s promise says when, not `useRevalidator().state`, which is still
`idle` in the render that asked for it.

## Lifecycles kept in timestamps

These are encoded as nullable timestamps, often with more than one column. The timestamps carry
the time as well as the state, and readers filter on them in SQL. A status column would need a
migration and would change the API, so they stay as they are. Their rules live in the command
that writes them. Where a state is derived from more than one column, it has one named
definition, in TypeScript, in SQL, or both; read the state through it rather than the columns.

| Lifecycle | Columns | Named states | Writes |
| --- | --- | --- | --- |
| Inbox, archive, trash | `documents.archivedAt`, `deletedAt` | `ARTICLE_IN` (inbox, archive, trash) in `services/documents.server.ts` | `apps/web/app/commands/articles.server.ts`, `services/documents.server.ts` (restore), `apps/worker/src/jobs/purge.ts` |
| Reading | `firstOpenedAt`, `readAt`, `lastReadAt`, `readingProgress`, `readingCycle`, `reading_completions` | finished (`readAt` set, nothing else): `isFinished` in `lib/inbox-filters.ts`, `finished` (SQL) in `services/documents.server.ts` | `commands/articles.server.ts`; leaving the reader at the end finishes (`hooks/use-finish-on-leave.ts`) |
| Editions | `publishedAt`, `republishedAt`, `unpublishedAt`, `removedAt` | `editionState()` (draft, live, unpublished, removed) in `apps/web/app/lib/editions.ts`; `liveEdition` (SQL) in `services/editions.server.ts` | `commands/editions-actions.server.ts`, `services/editions-write.server.ts`, `services/admin-reports.server.ts` |
| Highlight shares | `published`, `removedAt` | | `commands/highlight-shares.server.ts`, `services/admin-reports.server.ts` |
| Topic library | `topicLibraries.proposedAt`, `seenAt`, `confirmedAt`, … | `topicLibraryStage()` (proposing, proposed, confirmed) in `packages/db/src/lifecycles.ts` | `commands/topics.server.ts`, `apps/worker/src/topics.ts` (`run`) |
| Invites | `usedAt`, `expiresAt`, `revokedAt` | `STATUS_SQL` in `services/admin-invites.server.ts`; `findUsableInvite` in `lib/invites.server.ts` | `lib/invites.server.ts`, `services/admin-invites.server.ts` |
| Feed fetching | `nextFetchAt`, `errorCount`, `lastSuccessAt` | | `apps/worker/src/jobs/feeds.ts` |
| Images | `documentVersions.imagesDone` | | `packages/queue/src/admission.ts`, `apps/worker/src/jobs/images.ts` |

An article is finished when it has a finish date (`readAt`), and only then. "Mark as finished"
sets it, and so does leaving the reader after reaching the end, once enough time has passed on the
page (`secondsToFinish`). How far it was scrolled (`readingProgress`) drives the progress bar and
records a reading at 95%, but never finishes it: the reader may have jumped to the end, chosen
"Keep in Library", or undone the finish.

An edition an admin removed is also unpublished: removal sets `unpublishedAt` as well, publishing
refuses a removed edition, and restoring leaves it unpublished until its author publishes it again.
`editionState()` says `removed` first; the editor and the list show it as unpublished, with the
removal notice.

## Known gaps

Found while writing the machines down, and left as they are because fixing them changes
behavior:

- The worker starts extraction (`start`) with no status guard (`extract.ts`), and it does not
  check `deletedAt` again.
- A failure kept as `ready` (`keep`) leaves its `failureReason` set; the API shows it only for
  `failed`.
- `translationStatus: failed` stays after "Use original" and new captures; a translation
  superseded by a newer capture is also recorded as `failed` (its credits come back). The reader
  then shows "The article couldn't be translated" with Retry instead of the offer to translate.
- Retiring a topic has no status guard in its update. Its callers pick active topics.
- `noteSkippedAt` is not cleared when an article is read again: "Nothing to add" is for good
  (`skipNote` in the SDK: "never asked for a note on it again"), until taken back.
