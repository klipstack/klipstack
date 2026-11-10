import type { SpeechState } from "../../modules/klip-speech"
import { minutesLeft, progressAt, type SpeechLanguage } from "./speech"

/** The language and voice a reader reads in. */
type Voice = { language: SpeechLanguage; voice: string }

/**
 * Where reading aloud is, in one reader. Anything but `off` owns the speech (`claimSpeech`).
 * - `confirming`: the alert asks whether to download the voices.
 * - `downloading`: the voices download (`received` of `total` bytes).
 * - `preparing`: the page was asked for its sentences.
 * - `speaking`: the narrator has the sentences; `at` is the one being read.
 */
export type ReadAloud =
	| { phase: "off" }
	| ({ phase: "confirming"; bytes: number } & Voice)
	| ({ phase: "downloading"; received: number; total: number } & Voice)
	| ({ phase: "preparing" } & Voice)
	| { phase: "speaking"; state: Exclude<SpeechState, "idle">; sentences: string[]; at: number }

export const OFF: ReadAloud = { phase: "off" }

export type ReadAloudEvent =
	/** Read aloud was tapped, and the voices are known. */
	| ({ type: "start"; installed: boolean; bytes: number } & Voice)
	/** The download alert's buttons. */
	| { type: "cancel" }
	| { type: "download" }
	/** `speech.download` settled. */
	| { type: "downloaded" }
	| { type: "downloadFailed"; message: string }
	/** The page's sentences, and the one on screen to start from. */
	| { type: "sentences"; list: { text: string; pause: number }[]; start: number }
	/** `speech.speak` was refused. */
	| { type: "speakFailed"; message: string }
	/** The narrator's events, for whoever plays or downloads. */
	| { type: "sentence"; index: number }
	| { type: "state"; state: SpeechState; error: string | null }
	| { type: "progress"; language: SpeechLanguage; received: number; total: number }
	/** The person: a sentence tapped on the page, the player's buttons. */
	| { type: "seek"; index: number }
	| { type: "skip"; by: number }
	| { type: "playPause" }
	| { type: "close" }
	/** Another reader, or the voices screen's sample, took the speech over. */
	| { type: "taken" }
	/** The reader closed. */
	| { type: "leave" }

/** What a transition asks of the world, in order. */
export type ReadAloudEffect =
	| { type: "confirmDownload"; language: SpeechLanguage; bytes: number }
	| { type: "download"; language: SpeechLanguage }
	| { type: "askSentences"; language: SpeechLanguage }
	| ({ type: "speak"; sentences: string[]; pauses: number[]; start: number } & Voice)
	/** Marks the sentence read on the page; null clears it. */
	| { type: "mark"; index: number | null }
	| { type: "seek"; index: number }
	| { type: "pause" }
	| { type: "resume" }
	| { type: "stop" }
	| { type: "cancelDownload" }
	| { type: "failed"; message: string }
	| { type: "downloadStopped"; message: string }
	/** Read to the end. */
	| { type: "ended" }

type Step = { state: ReadAloud; effects: ReadAloudEffect[] }

const stay = (state: ReadAloud): Step => ({ state, effects: [] })
/** Off, with the page's mark cleared. */
const off = (...effects: ReadAloudEffect[]): Step => ({
	state: OFF,
	effects: [...effects, { type: "mark", index: null }],
})

/**
 * The next phase, and what to do. Pure: the hook (`useReadAloud`) runs the effects. An event that
 * makes no sense in a phase (a late download progress, a seek before the sentences) changes nothing.
 */
export function transition(state: ReadAloud, event: ReadAloudEvent): Step {
	switch (state.phase) {
		case "off":
			if (event.type !== "start") return stay(state)
			{
				const voice = { language: event.language, voice: event.voice }
				return event.installed
					? { state: { phase: "preparing", ...voice }, effects: [ask(event.language)] }
					: {
							state: { phase: "confirming", bytes: event.bytes, ...voice },
							effects: [{ type: "confirmDownload", language: event.language, bytes: event.bytes }],
						}
			}

		case "confirming":
			switch (event.type) {
				case "download":
					return {
						state: {
							phase: "downloading",
							language: state.language,
							voice: state.voice,
							received: 0,
							total: state.bytes,
						},
						effects: [{ type: "download", language: state.language }],
					}
				case "cancel":
				case "close":
				case "taken":
				case "leave":
					return off()
				default:
					return stay(state)
			}

		case "downloading":
			switch (event.type) {
				case "progress":
					// The voices screen may download another language meanwhile.
					if (event.language !== state.language) return stay(state)
					return stay({ ...state, received: event.received, total: event.total })
				case "downloaded":
					return {
						state: { phase: "preparing", language: state.language, voice: state.voice },
						effects: [ask(state.language)],
					}
				case "downloadFailed":
					return off({ type: "downloadStopped", message: event.message })
				case "close":
					return off({ type: "cancelDownload" })
				// The download goes on: whoever reads next needs the same files.
				case "taken":
				case "leave":
					return off()
				default:
					return stay(state)
			}

		case "preparing":
			switch (event.type) {
				case "sentences":
					return {
						state: {
							phase: "speaking",
							state: "loading",
							sentences: event.list.map((s) => s.text),
							at: event.start,
						},
						effects: [
							{
								type: "speak",
								language: state.language,
								voice: state.voice,
								sentences: event.list.map((s) => s.text),
								pauses: event.list.map((s) => s.pause),
								start: event.start,
							},
						],
					}
				case "close":
				case "leave":
					return off({ type: "stop" })
				case "taken":
					return off()
				default:
					return stay(state)
			}

		case "speaking":
			switch (event.type) {
				case "sentence":
					return {
						state: { ...state, at: event.index },
						effects: [{ type: "mark", index: event.index }],
					}
				case "state":
					if (event.state === "idle")
						return off(...(event.error ? [{ type: "failed", message: event.error } as const] : []))
					return {
						state: { ...state, state: event.state },
						effects: event.state === "ended" ? [{ type: "ended" }] : [],
					}
				case "seek":
					return { state, effects: [{ type: "seek", index: event.index }] }
				case "skip":
					return { state, effects: [{ type: "seek", index: Math.max(0, state.at + event.by) }] }
				case "playPause":
					return {
						state,
						effects: [
							state.state === "playing" || state.state === "loading"
								? { type: "pause" }
								: { type: "resume" },
						],
					}
				case "speakFailed":
					return off({ type: "stop" }, { type: "failed", message: event.message })
				case "close":
				case "leave":
					return off({ type: "stop" })
				// The new owner's speech replaces this one.
				case "taken":
					return off()
				default:
					return stay(state)
			}
	}
}

function ask(language: SpeechLanguage): ReadAloudEffect {
	return { type: "askSentences", language }
}

/** What the player shows; null while nothing does (off, or the download alert open). */
export type ListenStatus =
	| { kind: "downloading"; received: number; total: number }
	| { kind: "speech"; state: Exclude<SpeechState, "idle">; progress: number; minutesLeft: number }

export function listenStatus(state: ReadAloud, speed: number): ListenStatus | null {
	switch (state.phase) {
		case "off":
		case "confirming":
			return null
		case "downloading":
			return { kind: "downloading", received: state.received, total: state.total }
		case "preparing":
			return { kind: "speech", state: "loading", progress: 0, minutesLeft: 0 }
		case "speaking": {
			const at = state.state === "ended" ? state.sentences.length : state.at
			return {
				kind: "speech",
				state: state.state,
				progress: progressAt(state.sentences, at),
				minutesLeft: minutesLeft(state.sentences, at, speed),
			}
		}
	}
}
