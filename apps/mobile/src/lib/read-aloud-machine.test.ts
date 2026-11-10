import { describe, expect, it } from "vitest"
import {
	listenStatus,
	OFF,
	type ReadAloud,
	type ReadAloudEvent,
	transition,
} from "./read-aloud-machine"

const list = [
	{ text: "First sentence here.", pause: 0.3 },
	{ text: "Second one.", pause: 0.3 },
	{ text: "And the third, the longest of them all.", pause: 0.6 },
]

/** Runs events from a state; returns the last state and every effect, in order. */
function run(state: ReadAloud, ...events: ReadAloudEvent[]) {
	const effects = []
	for (const event of events) {
		const step = transition(state, event)
		state = step.state
		effects.push(...step.effects)
	}
	return { state, effects }
}

const startNew: ReadAloudEvent = {
	type: "start",
	language: "en",
	voice: "af_heart",
	installed: false,
	bytes: 1000,
}
const startInstalled: ReadAloudEvent = { ...startNew, installed: true }
const downloading = run(OFF, startNew, { type: "download" }).state
const speaking = run(OFF, startInstalled, { type: "sentences", list, start: 1 }).state
const playing = run(speaking, { type: "state", state: "playing", error: null }).state

describe("reading aloud", () => {
	it("asks before downloading the voices, downloads, then reads from the sentence on screen", () => {
		const { state, effects } = run(
			OFF,
			startNew,
			{ type: "download" },
			{ type: "progress", language: "en", received: 400, total: 1000 },
		)
		expect(listenStatus(state, 1)).toEqual({ kind: "downloading", received: 400, total: 1000 })
		expect(effects).toEqual([
			{ type: "confirmDownload", language: "en", bytes: 1000 },
			{ type: "download", language: "en" },
		])
		const next = run(state, { type: "downloaded" }, { type: "sentences", list, start: 1 })
		expect(next.effects).toEqual([
			{ type: "askSentences", language: "en" },
			{
				type: "speak",
				language: "en",
				voice: "af_heart",
				sentences: list.map((s) => s.text),
				pauses: [0.3, 0.3, 0.6],
				start: 1,
			},
		])
		expect(next.state).toMatchObject({ phase: "speaking", state: "loading", at: 1 })
	})

	it("shows no player while the download alert is open, and Cancel ends it", () => {
		const asking = run(OFF, startNew).state
		expect(asking.phase).toBe("confirming")
		expect(listenStatus(asking, 1)).toBeNull()
		expect(run(asking, { type: "cancel" }).state).toEqual(OFF)
	})

	it("ignores download progress unless its own download is running", () => {
		const progress: ReadAloudEvent = { type: "progress", language: "es", received: 5, total: 10 }
		// The voices screen downloads while the reader plays.
		expect(run(playing, progress)).toEqual({ state: playing, effects: [] })
		// …or another language while the reader downloads.
		expect(run(downloading, progress).state).toEqual(downloading)
		// The last progress event can arrive after the download finished.
		const preparing = run(downloading, { type: "downloaded" }).state
		expect(run(preparing, { ...progress, language: "en" }).state).toEqual(preparing)
	})

	it("closing cancels a download, and stops what plays", () => {
		expect(run(downloading, { type: "close" }).effects).toEqual([
			{ type: "cancelDownload" },
			{ type: "mark", index: null },
		])
		expect(run(playing, { type: "close" }).effects).toEqual([
			{ type: "stop" },
			{ type: "mark", index: null },
		])
		// A failure after closing has nothing to say.
		expect(
			run(downloading, { type: "close" }, { type: "downloadFailed", message: "x" }).effects,
		).toEqual([{ type: "cancelDownload" }, { type: "mark", index: null }])
	})

	it("says when the download failed", () => {
		expect(run(downloading, { type: "downloadFailed", message: "Offline" })).toEqual({
			state: OFF,
			effects: [
				{ type: "downloadStopped", message: "Offline" },
				{ type: "mark", index: null },
			],
		})
	})

	it("leaving the reader stops what it reads, but lets the download finish", () => {
		const preparing = run(OFF, startInstalled).state
		for (const state of [preparing, playing]) {
			expect(run(state, { type: "leave" }).effects).toEqual([
				{ type: "stop" },
				{ type: "mark", index: null },
			])
		}
		// Whoever reads next needs the same files.
		expect(run(downloading, { type: "leave" }).effects).toEqual([{ type: "mark", index: null }])
	})

	it("stops when speaking is refused, and says why", () => {
		const { state, effects } = run(speaking, { type: "speakFailed", message: "No voices" })
		expect(state).toEqual(OFF)
		expect(effects).toEqual([
			{ type: "stop" },
			{ type: "failed", message: "No voices" },
			{ type: "mark", index: null },
		])
	})

	it("seeks to a tapped sentence only once the narrator has the sentences", () => {
		const preparing = run(OFF, startInstalled).state
		expect(run(preparing, { type: "seek", index: 2 }).effects).toEqual([])
		expect(run(downloading, { type: "seek", index: 2 }).effects).toEqual([])
		expect(run(playing, { type: "seek", index: 2 }).effects).toEqual([{ type: "seek", index: 2 }])
		expect(run(playing, { type: "skip", by: -5 }).effects).toEqual([{ type: "seek", index: 0 }])
		// Skips count from the sentence being read.
		const later = run(playing, { type: "sentence", index: 2 }).state
		expect(run(later, { type: "skip", by: -1 }).effects).toEqual([{ type: "seek", index: 1 }])
		expect(run(later, { type: "skip", by: 1 }).effects).toEqual([{ type: "seek", index: 3 }])
	})

	it("pauses what plays or loads, and resumes what is paused", () => {
		const paused = run(playing, { type: "state", state: "paused", error: null }).state
		expect(run(playing, { type: "playPause" }).effects).toEqual([{ type: "pause" }])
		expect(run(speaking, { type: "playPause" }).effects).toEqual([{ type: "pause" }])
		expect(run(paused, { type: "playPause" }).effects).toEqual([{ type: "resume" }])
	})

	it("shows how far along it is and the minutes left at the chosen speed", () => {
		const preparing = run(OFF, startInstalled).state
		expect(listenStatus(preparing, 1)).toEqual({
			kind: "speech",
			state: "loading",
			progress: 0,
			minutesLeft: 0,
		})
		// 3,060 characters: 3 minutes at 1×, 2 at 1.5×; halfway once the first is read.
		const long = [
			{ text: "a".repeat(1530), pause: 0.3 },
			{ text: "b".repeat(1530), pause: 0.3 },
		]
		const reading = run(OFF, startInstalled, { type: "sentences", list: long, start: 0 }).state
		expect(listenStatus(reading, 1)).toMatchObject({ progress: 0, minutesLeft: 3 })
		expect(listenStatus(reading, 1.5)).toMatchObject({ progress: 0, minutesLeft: 2 })
		const second = run(reading, { type: "sentence", index: 1 }).state
		expect(listenStatus(second, 1)).toMatchObject({ progress: 0.5, minutesLeft: 2 })
	})

	it("marks each sentence read, and says when it reached the end", () => {
		const { state, effects } = run(
			playing,
			{ type: "sentence", index: 2 },
			{ type: "state", state: "ended", error: null },
		)
		expect(effects).toEqual([{ type: "mark", index: 2 }, { type: "ended" }])
		expect(listenStatus(state, 1)).toEqual({
			kind: "speech",
			state: "ended",
			progress: 1,
			minutesLeft: 0,
		})
		// Play from the end starts over; the narrator does that.
		expect(run(state, { type: "playPause" }).effects).toEqual([{ type: "resume" }])
	})

	it("closes when the narrator goes idle, saying why if it failed", () => {
		expect(run(playing, { type: "state", state: "idle", error: "Audio failed" })).toEqual({
			state: OFF,
			effects: [
				{ type: "failed", message: "Audio failed" },
				{ type: "mark", index: null },
			],
		})
		// Stopped with nothing wrong: no alert.
		expect(run(playing, { type: "state", state: "idle", error: null }).effects).toEqual([
			{ type: "mark", index: null },
		])
		// The narrator's leftovers don't end a reading that hasn't started.
		const preparing = run(OFF, startInstalled).state
		expect(run(preparing, { type: "state", state: "idle", error: null }).state).toEqual(preparing)
	})

	it("lets another reader take over without stopping its speech", () => {
		const asking = run(OFF, startNew).state
		const preparing = run(OFF, startInstalled).state
		for (const state of [asking, preparing, playing, downloading]) {
			expect(run(state, { type: "taken" })).toEqual({
				state: OFF,
				effects: [{ type: "mark", index: null }],
			})
		}
		// Another's speech no longer moves this player.
		const taken = run(playing, { type: "taken" }).state
		expect(run(taken, { type: "state", state: "playing", error: null }).effects).toEqual([])
	})
})
