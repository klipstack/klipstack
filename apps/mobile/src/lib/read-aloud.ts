import type { ArticleDetails } from "@klipstack/sdk"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Alert } from "react-native"
import type { PageMessage } from "@/page/messages"
import { speech } from "../../modules/klip-speech"
import { errorMessage, t } from "./i18n"
import {
	listenStatus,
	OFF,
	type ReadAloud,
	type ReadAloudEffect,
	type ReadAloudEvent,
	transition,
} from "./read-aloud-machine"
import { loadSpeechPrefs, saveSpeechPrefs } from "./reader-files"
import { formatBytes, nextSpeed, speechLanguage } from "./speech"

/**
 * Who plays: one reader (or the voices screen's sample) at a time. Taking over tells the one
 * before, whose player closes.
 */
type Owner = { release: () => void }
let owner: Owner | null = null

export function claimSpeech(me: Owner): void {
	if (owner && owner !== me) owner.release()
	owner = me
}

export function ownsSpeech(me: Owner): boolean {
	return owner === me
}

export function releaseSpeech(me: Owner): void {
	if (owner === me) owner = null
}

/**
 * Reading an article aloud, for the reader: downloads the voices the first time (after asking),
 * asks the page for its sentences, plays from the one on screen, and marks the one being read.
 * Its phases and what moves them are in `read-aloud-machine.ts`; this hook feeds it events and
 * runs its effects. `inject` runs a script in the page; the page's messages go through
 * `onMessage` first. `onEnded` when the article was read to its end, also with the screen locked.
 */
export function useReadAloud({
	article,
	textSample,
	inject,
	onEnded,
}: {
	article: ArticleDetails | null
	textSample: () => string
	inject: (script: string) => void
	onEnded?: () => void
}) {
	// The phase is read and changed through the ref, never a render's copy: native events and
	// promises arrive between renders.
	const machine = useRef<ReadAloud>(OFF)
	const [state, setState] = useState<ReadAloud>(OFF)
	const [speed, setSpeed] = useState(() => loadSpeechPrefs().speed)
	// What the effects need of the latest render: they run from native events and promises.
	const latest = useRef({ speed, article, inject, onEnded })
	useLayoutEffect(() => {
		latest.current = { speed, article, inject, onEnded }
	})
	const [me] = useState<Owner>(() => ({ release: () => send({ type: "taken" }) }))

	function send(event: ReadAloudEvent) {
		const before = machine.current
		const { state: next, effects } = transition(before, event)
		machine.current = next
		if (next !== before) setState(next)
		if (before.phase === "off" && next.phase !== "off") claimSpeech(me)
		if (next.phase === "off") releaseSpeech(me)
		for (const effect of effects) perform(effect)
	}

	function perform(effect: ReadAloudEffect) {
		switch (effect.type) {
			case "confirmDownload":
				Alert.alert(
					t("reader.readAloud.downloadTitle", {
						language: t(`reader.inLanguage.${effect.language}`),
					}),
					t("reader.readAloud.downloadMessage", { size: formatBytes(effect.bytes) }),
					[
						{
							text: t("common.actions.cancel"),
							style: "cancel",
							onPress: () => send({ type: "cancel" }),
						},
						{ text: t("reader.readAloud.download"), onPress: () => send({ type: "download" }) },
					],
				)
				return
			case "download":
				speech!.download(effect.language).then(
					() => send({ type: "downloaded" }),
					(e: unknown) => send({ type: "downloadFailed", message: errorMessage(e) }),
				)
				return
			case "askSentences":
				latest.current.inject(
					`window.klipSentences && window.klipSentences(${JSON.stringify(effect.language)}); true;`,
				)
				return
			case "speak": {
				const { article } = latest.current
				speech!
					.speak({
						sentences: effect.sentences,
						pauses: effect.pauses,
						start: effect.start,
						language: effect.language,
						voice: effect.voice,
						rate: latest.current.speed,
						title: article?.title ?? article?.url ?? "",
						artist: article?.site ?? "Klipstack",
					})
					.catch((e: unknown) => send({ type: "speakFailed", message: errorMessage(e) }))
				return
			}
			case "mark":
				latest.current.inject(
					`window.klipSpeaking && window.klipSpeaking(${effect.index ?? "null"}); true;`,
				)
				return
			case "seek":
				void speech?.seek(effect.index)
				return
			case "pause":
				void speech?.pause()
				return
			case "resume":
				void speech?.resume()
				return
			case "stop":
				void speech?.stop()
				return
			case "cancelDownload":
				void speech?.cancelDownload()
				return
			case "failed":
				Alert.alert(t("reader.readAloud.failed"), effect.message)
				return
			case "downloadStopped":
				Alert.alert(t("reader.voices.downloadStopped"), effect.message)
				return
			case "ended":
				latest.current.onEnded?.()
				return
		}
	}

	// `send` reads only refs and setters: the first render's is as good as any.
	const sendFirst = useRef(send)
	useEffect(() => {
		const send = sendFirst.current
		if (!speech) return
		const subscriptions = [
			speech.addListener("onSentence", ({ index }) => send({ type: "sentence", index })),
			speech.addListener("onState", ({ state, error }) => send({ type: "state", state, error })),
			speech.addListener("onDownload", (event) => send({ type: "progress", ...event })),
		]
		return () => {
			for (const subscription of subscriptions) subscription.remove()
			send({ type: "leave" })
		}
	}, [me])

	async function start() {
		if (!speech || !article) return
		const language = speechLanguage(article.language, textSample())
		if (!language) {
			Alert.alert(t("reader.readAloud.cantTitle"), t("reader.readAloud.cantMessage"))
			return
		}
		const pack = (await speech.languages()).find((p) => p.language === language)
		if (!pack) return
		const chosen = loadSpeechPrefs().voices[language]
		const voice = pack.voices.some((v) => v.id === chosen) ? chosen! : pack.voices[0]!.id
		send({ type: "start", language, voice, installed: pack.installed, bytes: pack.missingBytes })
	}

	/** The page's answers; true when the message was for reading aloud. */
	function onMessage(message: PageMessage) {
		if (message.type === "sentence") send({ type: "seek", index: message.index })
		else if (message.type === "sentences")
			send({ type: "sentences", list: message.list, start: message.start })
		else return false
		return true
	}

	function playPause() {
		send({ type: "playPause" })
	}

	function skip(by: number) {
		send({ type: "skip", by })
	}

	function close() {
		send({ type: "close" })
	}

	function cycleSpeed() {
		const next = nextSpeed(speed)
		setSpeed(next)
		saveSpeechPrefs({ ...loadSpeechPrefs(), speed: next })
		void speech?.setRate(next)
	}

	return {
		available: speech !== null,
		status: listenStatus(state, speed),
		speed,
		start,
		onMessage,
		playPause,
		skip,
		cycleSpeed,
		close,
	}
}
