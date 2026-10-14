import { type NativeModule, requireOptionalNativeModule } from "expo"

type Events = {
	/**
	 * Everything heard since `start`, punctuated, pauses included (the recognizer starts over after
	 * each; the module keeps what came before); `final` once it won't change again.
	 */
	onText(event: { text: string; final: boolean }): void
	/** Listening stopped: by `stop`, or by an error (said in `error`). */
	onEnd(event: { error: string | null }): void
}

declare class KlipDictation extends NativeModule<Events> {
	/**
	 * Starts listening, on the device only: asks for the microphone and speech recognition the
	 * first time. `language` is a BCP 47 code ("en", "es-ES"). Null once listening, or why not:
	 * permission `denied`, the language `unsupported` offline on this device, or the microphone
	 * `busy` (a call).
	 */
	start(language: string): Promise<"denied" | "unsupported" | "busy" | null>
	/** Stops listening; the last `onText` is final. */
	stop(): Promise<void>
}

/** Dictating a note, on the device: iOS builds only; null elsewhere (and in older builds). */
export const dictation = requireOptionalNativeModule<KlipDictation>("KlipDictation")
