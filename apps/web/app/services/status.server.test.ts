import { stopBoss } from "@klipstack/queue"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loader } from "~/routes/status"
import * as system from "./admin-system.server"
import {
	degradedReasons,
	publicStatus,
	QUEUE_STALL_SECONDS,
	type QueueFacts,
	queueStalled,
	resetStatusCache,
} from "./status.server"

const T = QUEUE_STALL_SECONDS
const facts = (over: Partial<QueueFacts>): QueueFacts => ({
	queue: "extract",
	waitingSeconds: null,
	active: 0,
	sinceStartSeconds: null,
	...over,
})
const worker = (state: system.WorkerState): system.WorkerStatus => ({
	state,
	instanceId: null,
	startedAt: null,
	lastSeenAt: null,
	secondsSinceSeen: null,
})

beforeEach(() => resetStatusCache())
afterEach(() => vi.restoreAllMocks())
afterAll(() => stopBoss())

describe("queue stall", () => {
	it("is a due job waiting past the limit with nothing running and nothing started", () => {
		expect(queueStalled(facts({ waitingSeconds: T + 1 }))).toBe(true)
		expect(queueStalled(facts({ waitingSeconds: T + 1, sinceStartSeconds: T + 1 }))).toBe(true)
	})

	it("is not an empty queue, a short wait, or a backlog being worked through", () => {
		expect(queueStalled(facts({}))).toBe(false)
		expect(queueStalled(facts({ waitingSeconds: T }))).toBe(false)
		expect(queueStalled(facts({ waitingSeconds: 7_200, sinceStartSeconds: 4 }))).toBe(false)
	})

	it("is not a long job holding its queue: pg-boss expires it if it hangs", () => {
		expect(
			queueStalled(facts({ waitingSeconds: T + 1, active: 1, sinceStartSeconds: 1_500 })),
		).toBe(false)
	})
})

describe("degraded reasons", () => {
	it("names a stale worker, and one that never reported", async () => {
		vi.spyOn(system, "readWorkerStatus").mockResolvedValue(worker("stale"))
		expect(await degradedReasons()).toContain("worker stale")
		vi.spyOn(system, "readWorkerStatus").mockResolvedValue(worker("unknown"))
		expect(await degradedReasons()).toContain("worker unknown")
	})

	it("names a check that cannot be read, without the error's message", async () => {
		vi.spyOn(system, "readWorkerStatus").mockRejectedValue(new Error("postgres://user:pw@host"))
		const reasons = await degradedReasons()
		expect(reasons).toContain("worker unreadable (Error)")
		expect(reasons.join()).not.toContain("postgres://")
	})
})

describe("/status", () => {
	it("answers one word: ok with 200, degraded with 503", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.spyOn(system, "readWorkerStatus").mockResolvedValue(worker("stale"))
		const degraded = await loader()
		expect(degraded.status).toBe(503)
		expect(await degraded.text()).toBe("degraded")
		expect(degraded.headers.get("Cache-Control")).toBe("no-store")
	})

	it("shares one check between callers until the cache ends", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		const read = vi.spyOn(system, "readWorkerStatus").mockResolvedValue(worker("stale"))
		await Promise.all([publicStatus(1_000), publicStatus(1_001), publicStatus(15_999)])
		expect(read).toHaveBeenCalledTimes(1)
		await publicStatus(16_000)
		expect(read).toHaveBeenCalledTimes(2)
	})
})
