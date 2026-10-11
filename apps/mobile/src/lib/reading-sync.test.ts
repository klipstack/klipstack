import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createReadingSync } from "./reading-sync"

function setup({
	opened = true,
	position = 0.2,
	cycle = 1,
	openCycle,
}: { opened?: boolean; position?: number; cycle?: number; openCycle?: number } = {}) {
	const opens: number[] = []
	const saves: Array<[number, number]> = []
	const sync = createReadingSync({
		opened,
		position,
		cycle,
		open: async () => {
			opens.push(1)
			return { cycle: openCycle ?? cycle }
		},
		save: async (at, c) => {
			saves.push([at, c])
		},
	})
	return { sync, opens, saves }
}

describe("createReadingSync", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("opens a read article again at once, and saves with the cycle that returns", async () => {
		const { sync, opens, saves } = setup({ cycle: 1, openCycle: 2 })
		expect(opens).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(0)
		sync.scrolled(0.5, false)
		await vi.advanceTimersByTimeAsync(1500)
		expect(saves).toEqual([[0.5, 2]])
	})

	it("keeps a new article new until the user reads", async () => {
		const { sync, opens, saves } = setup({ opened: false })
		sync.scrolled(0.4, false)
		await vi.advanceTimersByTimeAsync(2000)
		expect(opens).toHaveLength(0)
		expect(saves).toEqual([])
		sync.scrolled(0.6, true)
		await vi.advanceTimersByTimeAsync(1500)
		expect(opens).toHaveLength(1)
		expect(saves).toEqual([[0.6, 1]])
		sync.engage()
		expect(opens).toHaveLength(1)
	})

	it("saves after a pause, only moves of 0.05 or more, and the end", async () => {
		const { sync, saves } = setup({ position: 0.2 })
		sync.scrolled(0.22, false)
		await vi.advanceTimersByTimeAsync(1500)
		expect(saves).toEqual([])
		sync.scrolled(0.3, false)
		await vi.advanceTimersByTimeAsync(1000)
		sync.scrolled(0.35, false)
		await vi.advanceTimersByTimeAsync(1000)
		expect(saves).toEqual([])
		await vi.advanceTimersByTimeAsync(500)
		expect(saves).toEqual([[0.35, 1]])
		sync.scrolled(0.98, false)
		await vi.advanceTimersByTimeAsync(1500)
		sync.scrolled(0.99, false)
		await vi.advanceTimersByTimeAsync(1500)
		expect(saves).toEqual([
			[0.35, 1],
			[0.98, 1],
			[0.99, 1],
		])
	})

	it("flushes the exact position at once, and nothing when it didn't move", async () => {
		const { sync, saves } = setup({ position: 0.2 })
		sync.flush()
		sync.scrolled(0.21, false)
		sync.flush()
		await vi.advanceTimersByTimeAsync(5000)
		expect(saves).toEqual([[0.21, 1]])
	})

	it("returns the flushed save, which lands before it settles and never fails", async () => {
		let land: (() => void) | undefined
		let fail: ((error: Error) => void) | undefined
		const landed: number[] = []
		const sync = createReadingSync({
			opened: true,
			position: 0.2,
			cycle: 1,
			open: async () => ({ cycle: 1 }),
			save: (at) =>
				new Promise<void>((resolve, reject) => {
					land = () => {
						landed.push(at)
						resolve()
					}
					fail = reject
				}),
		})
		expect(sync.flush()).toBeUndefined()
		sync.scrolled(0.4, false)
		const saving = sync.flush()
		expect(saving).toBeInstanceOf(Promise)
		land?.()
		await saving
		expect(landed).toEqual([0.4])

		sync.scrolled(0.5, false)
		const failing = sync.flush()
		fail?.(new Error("offline"))
		await expect(failing).resolves.toBeUndefined()
	})

	it("sends a failed save again on the way out, and keeps going", async () => {
		const saves: number[] = []
		const sync = createReadingSync({
			opened: true,
			position: 0,
			cycle: 0,
			open: async () => ({ cycle: 0 }),
			save: async (at) => {
				saves.push(at)
				if (saves.length === 1) throw new Error("offline")
			},
		})
		sync.scrolled(0.5, false)
		await vi.advanceTimersByTimeAsync(1500)
		// The reader stopped there and leaves: the position that failed goes again.
		sync.flush()
		await vi.advanceTimersByTimeAsync(0)
		sync.scrolled(0.6, false)
		await vi.advanceTimersByTimeAsync(1500)
		expect(saves).toEqual([0.5, 0.5, 0.6])
	})
})
