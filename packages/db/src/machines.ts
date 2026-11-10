import { documentStatus, translationStatus } from "./schema/app"
import { topicStatus } from "./schema/topics"

/**
 * The lifecycles kept in a status column, each written down once: its states (the column's values,
 * from the schema) and every move between them. A move with no `from` creates the row in its `to`.
 *
 * Code that changes a status writes a transition's `to` (`extractionMachine.transitions.start.to`), never
 * a literal, so a search for the transition finds every writer (`pnpm lint`:
 * `klipstack/status-through-machine`). A `from` lists where the move can happen in the running
 * system; the writer's own guards (row locks, `where status = …`) are what enforce it, and `can`
 * asks the same question in code. docs/development/state-machines.md lists these machines and the
 * lifecycles still implicit (nullable timestamps, client state).
 */
export interface Machine<S, E extends string> {
	readonly states: readonly S[]
	readonly transitions: {
		readonly [K in E]: { readonly from: readonly NoInfer<S>[]; readonly to: NoInfer<S> }
	}
}

const machine = <const S, const E extends string>(m: Machine<S, E>) => m

/** Whether `event` may happen to a row in `state`. */
export function can<S, E extends string>(m: Machine<S, E>, event: E, state: S): boolean {
	return m.transitions[event].from.includes(state)
}

/**
 * Reading a saved article: `documents.status`. Admission (packages/queue/src/admission.ts) queues
 * the work under the row lock; the worker (apps/worker/src/jobs/extract.ts, publish.ts) runs it;
 * the sweep (apps/worker/src/jobs/sweep.ts) settles work whose job is gone. A failure never takes
 * a readable version away: with one, the article goes back to `ready` instead (`keep`).
 */
export const extractionMachine = machine({
	states: documentStatus,
	transitions: {
		/** Saved: its first capture waits for the worker. */
		save: { from: [], to: "queued" },
		/** A new capture was stored (saved again, from the extension, "read the post instead"). */
		capture: { from: ["queued", "processing", "ready", "failed"], to: "queued" },
		/** Read again whatever the status: restored from the trash, the re-extract script. */
		refresh: { from: ["queued", "processing", "ready", "failed"], to: "queued" },
		/** The owner's or an admin's Retry: only a failed article. */
		retry: { from: ["failed"], to: "queued" },
		/**
		 * The job starts. From `processing` when pg-boss runs a job again after a crash, from `ready`
		 * when an attempt failed and kept a readable version, from `failed` when the sweep settled
		 * the article while its job was being admitted. The worker does not check it.
		 */
		start: { from: ["queued", "processing", "ready", "failed"], to: "processing" },
		/** A version was made from the capture. */
		publish: { from: ["processing"], to: "ready" },
		/** An attempt failed, with no readable version, and pg-boss tries again. */
		retryLater: { from: ["processing"], to: "queued" },
		/** The last attempt failed (or the sweep found no job left), with no readable version. */
		fail: { from: ["queued", "processing"], to: "failed" },
		/** As `fail`, but the article has a readable version: it stays readable. */
		keep: { from: ["queued", "processing"], to: "ready" },
	},
})

export type ExtractionStatus = (typeof extractionMachine.states)[number]

/** Work waiting or running: what Home counts as "on its way". */
export const EXTRACTION_PENDING = ["queued", "processing"] as const satisfies ExtractionStatus[]

/**
 * Translating an article: `documents.translationStatus`, null while no translation is asked for
 * or after the last one was shown. Admission (packages/queue/src/translation.ts) asks for it, the
 * worker (apps/worker/src/jobs/translate.ts) makes it, and gives the credits back on `fail`.
 */
export const translationMachine = machine({
	states: [null, ...translationStatus],
	transitions: {
		/** A saved article has no translation asked for. */
		save: { from: [], to: null },
		/** Queued, its credits taken. */
		request: { from: [null, "failed"], to: "pending" },
		/** A translation made before is shown again, for free. */
		reuse: { from: [null, "failed"], to: null },
		/** The translation is shown. */
		finish: { from: ["pending"], to: null },
		/** Out of attempts, superseded by a newer capture, trashed, or its job lost (the sweep). */
		fail: { from: ["pending"], to: "failed" },
	},
})

export type TranslationState = (typeof translationMachine.states)[number]

/**
 * A topic of the reader's library: `topics.status`. The worker (apps/worker/src/topics.ts)
 * proposes, grows and retires topics; the reader confirms, removes and renames them
 * (apps/web/app/commands/topics.server.ts). `retired` and `removed` are final.
 */
export const topicMachine = machine({
	states: topicStatus,
	transitions: {
		/** One of the first topics, proposed to the reader. */
		propose: { from: [], to: "proposed" },
		/** Added once the library is confirmed: grown, or split or merged from others. */
		grow: { from: [], to: "active" },
		/** Kept when the reader confirms the first topics. */
		confirm: { from: ["proposed"], to: "active" },
		/** Left out when the reader confirms the first topics: never proposed again. */
		reject: { from: ["proposed"], to: "removed" },
		/** Removed by the reader: never proposed again. */
		remove: { from: ["active"], to: "removed" },
		/** Ended by a review, a split or a merge: its name may be proposed again. */
		retire: { from: ["active"], to: "retired" },
	},
})
