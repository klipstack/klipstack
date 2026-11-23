import { parentPort } from "node:worker_threads"
import { serveTasks } from "./thread-pool"

/** A thread for thread-pool.test.ts: each task says how to behave. */
export type FixtureTask =
	| { kind: "echo"; value: string }
	| { kind: "sleep"; ms: number }
	| { kind: "spin" }
	| { kind: "throw"; code: string }
	| { kind: "exit" }
	/** Answers, then throws from a timer: an error while the thread is idle. */
	| { kind: "late-throw" }

/** A parser stuck in a loop: nothing but terminating the thread stops it. */
function spin(): never {
	for (;;);
}

serveTasks(parentPort, async (task: FixtureTask) => {
	switch (task.kind) {
		case "echo":
			return { value: task.value }
		case "sleep": {
			const start = Date.now()
			await new Promise((resolve) => setTimeout(resolve, task.ms))
			return { start, end: Date.now() }
		}
		case "spin":
			return spin()
		case "throw":
			throw Object.assign(new Error("refused"), { code: task.code })
		case "late-throw":
			setTimeout(() => {
				throw new Error("late error in an idle thread")
			}, 50)
			return { value: "answered" }
		case "exit":
			process.exit(3)
	}
})
