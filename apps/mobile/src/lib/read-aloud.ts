import type { ArticleDetails } from "@klipstack/sdk"
import { useEffect, useRef, useState } from "react"
import { Alert } from "react-native"
import type { ListenStatus } from "@/components/listen-bar"
import type { PageMessage } from "@/page/messages"
import { speech } from "../../modules/klip-speech"
import { loadSpeechPrefs, saveSpeechPrefs } from "./reader-files"
import {
	formatBytes,
	LANGUAGE_NAMES,
	minutesLeft,
	nextSpeed,
	progressAt,
	type SpeechLanguage,
	speechLanguage,
} from "./speech"

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
 * `inject` runs a script in the page; the page's messages go through `onMessage` first.
 */
export function useReadAloud({
	article,
	textSample,
	inject,
}: {
	article: ArticleDetails | null
	textSample: () => string
	inject: (script: string) => void
}) {
	const [status, setStatus] = useState<ListenStatus | null>(null)
	const [speed, setSpeed] = useState(() => loadSpeechPrefs().speed)
	const sentences = useRef<string[]>([])
	const pending = useRef<{ language: SpeechLanguage; voice: string } | null>(null)
	const at = useRef(0)
	const speedNow = useRef(speed)
	speedNow.current = speed
	const injectNow = useRef(inject)
	injectNow.current = inject
	const [me] = useState<Owner>(() => ({
		release: () => {
			pending.current = null
			setStatus(null)
			injectNow.current("window.klipSpeaking && window.klipSpeaking(null); true;")
		},
	}))

	const place = (index: number) => ({
		progress: progressAt(sentences.current, index),
		minutesLeft: minutesLeft(sentences.current, index, speedNow.current),
	})

	useEffect(() => {
		if (!speech) return
		const subscriptions = [
			speech.addListener("onSentence", ({ index }) => {
				if (!ownsSpeech(me)) return
				at.current = index
				injectNow.current(`window.klipSpeaking && window.klipSpeaking(${index}); true;`)
				setStatus((s) => (s?.kind === "speech" ? { ...s, ...place(index) } : s))
			}),
			speech.addListener("onState", ({ state, error }) => {
				if (!ownsSpeech(me)) return
				if (state === "idle") {
					if (error) Alert.alert("Couldn't read aloud", error)
					releaseSpeech(me)
					me.release()
					return
				}
				setStatus({
					kind: "speech",
					state,
					...place(state === "ended" ? sentences.current.length : at.current),
				})
			}),
			speech.addListener("onDownload", ({ received, total }) => {
				if (ownsSpeech(me)) setStatus({ kind: "downloading", received, total })
			}),
		]
		return () => {
			for (const subscription of subscriptions) subscription.remove()
			if (ownsSpeech(me)) {
				releaseSpeech(me)
				void speech?.stop()
			}
		}
	}, [me])

	async function start() {
		if (!speech || !article) return
		const language = speechLanguage(article.language, textSample())
		if (!language) {
			Alert.alert("Can't read this aloud", "Voices are available in English and Spanish.")
			return
		}
		const pack = (await speech.languages()).find((p) => p.language === language)
		if (!pack) return
		const chosen = loadSpeechPrefs().voices[language]
		const voice = pack.voices.some((v) => v.id === chosen) ? chosen! : pack.voices[0]!.id
		claimSpeech(me)
		if (pack.installed) return ask(language, voice)
		Alert.alert(
			`Download ${LANGUAGE_NAMES[language]} voices?`,
			`Klipstack reads aloud on this iPhone, also offline. It needs a one-time download of ${formatBytes(pack.missingBytes)}.`,
			[
				{ text: "Cancel", style: "cancel", onPress: () => releaseSpeech(me) },
				{ text: "Download", onPress: () => void download(language, voice, pack.missingBytes) },
			],
		)
	}

	async function download(language: SpeechLanguage, voice: string, total: number) {
		setStatus({ kind: "downloading", received: 0, total })
		try {
			await speech!.download(language)
		} catch (e) {
			// Closing the player cancels the download: nothing to say then.
			if (ownsSpeech(me)) {
				Alert.alert("Download stopped", e instanceof Error ? e.message : String(e))
				close()
			}
			return
		}
		if (ownsSpeech(me)) ask(language, voice)
	}

	function ask(language: SpeechLanguage, voice: string) {
		pending.current = { language, voice }
		setStatus({ kind: "speech", state: "loading", progress: 0, minutesLeft: 0 })
		inject(`window.klipSentences && window.klipSentences(${JSON.stringify(language)}); true;`)
	}

	/** The page's answers; true when the message was for reading aloud. */
	function onMessage(message: PageMessage) {
		if (message.type === "sentence") {
			if (ownsSpeech(me) && status?.kind === "speech") void speech?.seek(message.index)
			return true
		}
		if (message.type !== "sentences") return false
		const request = pending.current
		pending.current = null
		if (!request || !speech || !article || !ownsSpeech(me)) return true
		const { list, start } = message
		sentences.current = list.map((s) => s.text)
		at.current = start
		setStatus({ kind: "speech", state: "loading", ...place(start) })
		speech
			.speak({
				sentences: sentences.current,
				pauses: list.map((s) => s.pause),
				start,
				language: request.language,
				voice: request.voice,
				rate: speedNow.current,
				title: article.title ?? article.url,
				artist: article.site ?? "Klipstack",
			})
			.catch((e: unknown) => {
				if (!ownsSpeech(me)) return
				Alert.alert("Couldn't read aloud", e instanceof Error ? e.message : String(e))
				close()
			})
		return true
	}

	function playPause() {
		if (status?.kind !== "speech") return
		if (status.state === "playing" || status.state === "loading") void speech?.pause()
		else void speech?.resume()
	}

	function skip(by: number) {
		if (status?.kind === "speech") void speech?.seek(Math.max(0, at.current + by))
	}

	function cycleSpeed() {
		const next = nextSpeed(speed)
		setSpeed(next)
		saveSpeechPrefs({ ...loadSpeechPrefs(), speed: next })
		void speech?.setRate(next)
		setStatus((s) =>
			s?.kind === "speech"
				? { ...s, minutesLeft: minutesLeft(sentences.current, at.current, next) }
				: s,
		)
	}

	function close() {
		if (!ownsSpeech(me)) return
		if (status?.kind === "downloading") void speech?.cancelDownload()
		else void speech?.stop()
		releaseSpeech(me)
		me.release()
	}

	return {
		available: speech !== null,
		status,
		speed,
		start,
		onMessage,
		playPause,
		skip,
		cycleSpeed,
		close,
	}
}
