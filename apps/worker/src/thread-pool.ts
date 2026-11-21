import { type ResourceLimits, Worker } from "node:worker_threads"

/**
 * Runs CPU-heavy work (parsing a page) on worker threads, off the event loop the queues, the
 * heartbeat and pg-boss share. A task that runs past its time limit has its thread terminated:
 * synchronous code cannot be interrupted any other way. A thread that crashes (out of memory, an
 * uncaught error) takes only its own task with it. Either way the next task gets a new thread.
 *
 * At most `size` tasks run at once; the rest wait their turn, in order.
 *
 * The thread script receives `{ id, input }` messages and answers `{ id, ok: true, value }` or
 * `{ id, ok: false, error }`, where `error` is the thrown error's own fields (`errorFields`).
 */

/** The task ran past its time limit, and its thread was terminated. */
export class ThreadTimeoutError extends Error {
	constructor(readonly limitMs: number) {
		super(`Thread task ran past ${limitMs}ms`)
		this.name = "ThreadTimeoutError"
	}
}

/** The thread died before answering: out of memory, or an error outside the task. */
export class ThreadCrashError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = "ThreadCrashError"
	}
}

/** What crosses the thread boundary of a thrown error: its name, message and own fields. */
export type ErrorFields = { name: string; message: string } & Record<string, unknown>

export function errorFields(error: unknown): ErrorFields {
	if (!(error instanceof Error)) return { name: "Error", message: String(error) }
	const fields: ErrorFields = { name: error.name, message: error.message }
	for (const [key, value] of Object.entries(error))
		if (value === null || ["string", "number", "boolean"].includes(typeof value))
			fields[key] = value
	return fields
}

type Reply<Out> =
	| { id: number; ok: true; value: Out }
	| { id: number; ok: false; error: ErrorFields }

export interface ThreadPoolOptions {
	/** The thread's module. */
	script: URL
	/** Tasks running at once, each on its own thread. */
	size: number
	/** A task's time limit, unless `run` is given a shorter one. */
	timeoutMs: number
	/** Heap limits per thread: a page that needs more crashes its thread, not the process. */
	resourceLimits?: ResourceLimits
	/** Turns a task's thrown error back into an error on this side. */
	reviveError?: (fields: ErrorFields) => Error
}

export interface ThreadPool<In, Out> {
	run(input: In, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Out>
	/** Tasks running and tasks waiting for a thread. */
	stats(): { running: number; waiting: number }
	/** Terminates every thread. Tasks still running reject. */
	close(): Promise<void>
}

/** Resolved here, where tsx is a dependency: a thread's eval code has no module to resolve from. */
const TSX_API = import.meta.resolve("tsx/esm/api")

const plainError = (fields: ErrorFields) => Object.assign(new Error(fields.message), fields)

export function createThreadPool<In, Out>({
	script,
	size,
	timeoutMs,
	resourceLimits,
	reviveError = plainError,
}: ThreadPoolOptions): ThreadPool<In, Out> {
	if (!Number.isInteger(size) || size < 1) throw new Error(`thread pool size must be >= 1: ${size}`)
	/** Idle threads, kept for the next task: starting one loads the parser again. */
	const idle: Worker[] = []
	const all = new Set<Worker>()
	const queue: Array<() => void> = []
	let running = 0
	let nextId = 0

	const spawn = () => {
		// The worker runs TypeScript through tsx, and so does each thread: Node does not pass the
		// process's `--import tsx` on to a thread's loader, so the thread registers tsx itself
		// before it imports the script.
		const worker = new Worker(
			`import(${JSON.stringify(TSX_API)}).then(({ register }) => { register(); return import(${JSON.stringify(script.href)}) })`,
			{
				eval: true,
				resourceLimits,
			},
		)
		all.add(worker)
		worker.once("exit", () => {
			all.delete(worker)
			const at = idle.indexOf(worker)
			if (at >= 0) idle.splice(at, 1)
		})
		// An idle thread does not keep the process alive.
		worker.unref()
		return worker
	}

	/** A finished task hands its slot straight to the next one waiting, so none can slip in between. */
	const release = () => {
		const next = queue.shift()
		if (next) next()
		else running--
	}

	const execute = (worker: Worker, input: In, limitMs: number, signal?: AbortSignal) =>
		new Promise<Out>((resolve, reject) => {
			const id = nextId++
			let settled = false
			const finish = (keep: boolean, settle: () => void) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				signal?.removeEventListener("abort", onAbort)
				worker.off("message", onMessage)
				worker.off("error", onError)
				worker.off("exit", onExit)
				if (keep) {
					worker.unref()
					idle.push(worker)
				} else void worker.terminate()
				settle()
			}
			const onMessage = (reply: Reply<Out>) => {
				if (reply.id !== id) return
				finish(true, () => (reply.ok ? resolve(reply.value) : reject(reviveError(reply.error))))
			}
			const onError = (error: Error) =>
				finish(false, () =>
					reject(new ThreadCrashError(`thread failed: ${error.message}`, { cause: error })),
				)
			const onExit = (code: number) =>
				finish(false, () => reject(new ThreadCrashError(`thread exited with code ${code}`)))
			const onAbort = () => finish(false, () => reject(signal?.reason))
			const timer = setTimeout(
				() => finish(false, () => reject(new ThreadTimeoutError(limitMs))),
				limitMs,
			)
			worker.on("message", onMessage)
			worker.once("error", onError)
			worker.once("exit", onExit)
			signal?.addEventListener("abort", onAbort, { once: true })
			worker.ref()
			worker.postMessage({ id, input })
		})

	return {
		async run(input, options = {}) {
			const { signal } = options
			signal?.throwIfAborted()
			if (running < size) running++
			else {
				// The slot comes from `release`, already counted.
				await new Promise<void>((resolve, reject) => {
					const turn = () => {
						signal?.removeEventListener("abort", leave)
						resolve()
					}
					const leave = () => {
						const at = queue.indexOf(turn)
						if (at >= 0) queue.splice(at, 1)
						reject(signal?.reason)
					}
					queue.push(turn)
					signal?.addEventListener("abort", leave, { once: true })
				})
			}
			try {
				const worker = idle.pop() ?? spawn()
				return await execute(
					worker,
					input,
					Math.min(options.timeoutMs ?? timeoutMs, timeoutMs),
					signal,
				)
			} finally {
				release()
			}
		},
		stats: () => ({ running, waiting: queue.length }),
		async close() {
			idle.length = 0
			await Promise.all([...all].map((worker) => worker.terminate()))
		},
	}
}

/** The thread's side: answers each task with `handle`'s result or its error's fields. */
export function serveTasks<In, Out>(
	port: import("node:worker_threads").MessagePort | null,
	handle: (input: In) => Out | Promise<Out>,
): void {
	if (!port) throw new Error("serveTasks runs only in a worker thread")
	port.on("message", async ({ id, input }: { id: number; input: In }) => {
		try {
			port.postMessage({ id, ok: true, value: await handle(input) } satisfies Reply<Out>)
		} catch (error) {
			port.postMessage({ id, ok: false, error: errorFields(error) } satisfies Reply<Out>)
		}
	})
}
