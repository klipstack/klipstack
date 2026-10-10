import { type NativeModule, requireOptionalNativeModule } from "expo"

/** Languages with voices; an article in another language can't be read aloud. */
export type SpeechLanguage = "en" | "es"

export type Voice = { id: string; name: string }

/** A language's download: Kokoro's model (shared), a pronunciation dictionary, its voices. */
export type LanguagePack = {
	language: SpeechLanguage
	installed: boolean
	/** Still to download; the model counts once, in each language that lacks it. */
	missingBytes: number
	totalBytes: number
	voices: Voice[]
}

export type SpeechState = "idle" | "loading" | "playing" | "paused" | "ended"

export type SpeakOptions = {
	sentences: string[]
	/** Silence after each sentence, in seconds. */
	pauses: number[]
	/** The sentence to start from. */
	start: number
	language: SpeechLanguage
	voice: string
	/** Playback speed: 1 is Kokoro's own pace. */
	rate: number
	/** For the lock screen. */
	title: string
	artist: string
}

type Events = {
	onSentence(event: { index: number }): void
	onState(event: { state: SpeechState; error: string | null }): void
	onDownload(event: { language: SpeechLanguage; received: number; total: number }): void
}

declare class KlipSpeech extends NativeModule<Events> {
	languages(): Promise<LanguagePack[]>
	download(language: SpeechLanguage): Promise<void>
	cancelDownload(): Promise<void>
	remove(language: SpeechLanguage): Promise<void>
	speak(options: SpeakOptions): Promise<void>
	pause(): Promise<void>
	resume(): Promise<void>
	stop(): Promise<void>
	seek(index: number): Promise<void>
	setRate(rate: number): Promise<void>
}

/** Reading aloud, on the device: iOS builds only; null elsewhere (and in older builds). */
export const speech = requireOptionalNativeModule<KlipSpeech>("KlipSpeech")
