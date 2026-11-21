import { afterEach, describe, expect, it } from "vitest"
import {
	createThreadPool,
	ThreadCrashError,
	type ThreadPool,
	ThreadTimeoutError,
} from "./thread-pool"
import type { FixtureTask } from "./thread-pool.fixture"

const script = new URL("./thread-pool.fixture.ts", import.meta.url)
let pool: ThreadPool<FixtureTask, unknown> | undefined

afterEach(async () => {
	await pool?.close()
	pool = undefined
})

const make = (size: number, timeoutMs = 10_000) => {
	pool = createThreadPool<FixtureTask, unknown>({ script, size, timeoutMs })
	return pool
}

describe("createThreadPool", () => {
	it("returns the thread's answer, and reuses the thread", async () => {
		const p = make(1)
		expect(await p.run({ kind: "echo", value: "a" })).toEqual({ value: "a" })
		expect(await p.run({ kind: "echo", value: "b" })).toEqual({ value: "b" })
	})

	it("terminates a task stuck in a loop at its time limit, while the event loop keeps going", async () => {
		const p = make(1, 500)
		let ticks = 0
		const ticker = setInterval(() => ticks++, 50)
		const started = Date.now()
		await expect(p.run({ kind: "spin" })).rejects.toBeInstanceOf(ThreadTimeoutError)
		clearInterval(ticker)
		const took = Date.now() - started
		expect(took).toBeGreaterThanOrEqual(450)
		expect(took).toBeLessThan(3_000)
		// The main thread was free while the thread spun.
		expect(ticks).toBeGreaterThanOrEqual(5)
		// The next task gets a new thread.
		expect(await p.run({ kind: "echo", value: "after" })).toEqual({ value: "after" })
	})

	it("takes a shorter limit per task", async () => {
		const p = make(1, 10_000)
		const started = Date.now()
		await expect(p.run({ kind: "spin" }, { timeoutMs: 300 })).rejects.toThrow(ThreadTimeoutError)
		expect(Date.now() - started).toBeLessThan(2_000)
	})

	it("stops a task when its signal aborts", async () => {
		const p = make(1)
		const signal = AbortSignal.timeout(300)
		await expect(p.run({ kind: "spin" }, { signal })).rejects.toMatchObject({
			name: "TimeoutError",
		})
		expect(await p.run({ kind: "echo", value: "ok" })).toEqual({ value: "ok" })
	})

	it("runs at most `size` tasks at once; the others wait their turn", async () => {
		const p = make(2)
		const runs = Array.from({ length: 6 }, () => p.run({ kind: "sleep", ms: 150 }))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(p.stats()).toEqual({ running: 2, waiting: 4 })
		const spans = (await Promise.all(runs)) as Array<{ start: number; end: number }>
		for (const { start } of spans) {
			const overlapping = spans.filter((s) => s.start <= start && start < s.end)
			expect(overlapping.length).toBeLessThanOrEqual(2)
		}
		expect(p.stats()).toEqual({ running: 0, waiting: 0 })
	})

	it("passes a task's error back with its fields", async () => {
		const p = make(1)
		await expect(p.run({ kind: "throw", code: "no_content" })).rejects.toMatchObject({
			message: "refused",
			code: "no_content",
		})
	})

	it("fails only the task whose thread died, and carries on", async () => {
		const p = make(2)
		const [died, other] = await Promise.allSettled([
			p.run({ kind: "exit" }),
			p.run({ kind: "sleep", ms: 100 }),
		])
		expect(died).toMatchObject({ status: "rejected", reason: expect.any(ThreadCrashError) })
		expect(other.status).toBe("fulfilled")
		expect(await p.run({ kind: "echo", value: "still here" })).toEqual({ value: "still here" })
	})

	it("refuses a size below one", () => {
		expect(() => createThreadPool({ script, size: 0, timeoutMs: 1 })).toThrow()
	})
})
