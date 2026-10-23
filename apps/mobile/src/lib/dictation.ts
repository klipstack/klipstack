import { useEffect, useRef, useState } from "react"
import { Alert, Linking } from "react-native"
import { dictation } from "../../modules/klip-dictation"
import { t } from "./i18n"

/** The device's language, for the recognizer: what the reader speaks, whatever they read. */
function deviceLanguage(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale || "en-US"
	} catch {
		return "en-US"
	}
}

/**
 * Dictating into a note (`modules/klip-dictation`): `start` listens, on the device only, and
 * `onHeard` gets everything heard since, as the recognizer rewrites it; `stop` ends it. Refusals
 * (no permission, a language this iPhone can't recognize offline, the microphone busy) are said in
 * an alert. `drop` stops it and ignores what is still to come: the reader typed meanwhile.
 */
export function useDictation(onHeard: (heard: string) => void) {
	const [listening, setListening] = useState(false)
	const heard = useRef(onHeard)
	useEffect(() => {
		heard.current = onHeard
	})
	const active = useRef(false)

	useEffect(() => {
		if (!dictation) return
		const subscriptions = [
			dictation.addListener("onText", ({ text }) => {
				if (active.current) heard.current(text)
			}),
			dictation.addListener("onEnd", ({ error }) => {
				if (!active.current) return
				active.current = false
				setListening(false)
				if (error) Alert.alert(t("reader.dictation.stopped"), error)
			}),
		]
		return () => {
			for (const subscription of subscriptions) subscription.remove()
			if (active.current) void dictation?.stop()
			active.current = false
		}
	}, [])

	async function start() {
		if (!dictation || active.current) return
		active.current = true
		setListening(true)
		const problem = await dictation.start(deviceLanguage())
		if (!problem) return
		active.current = false
		setListening(false)
		if (problem === "denied")
			Alert.alert(t("reader.dictation.allowTitle"), t("reader.dictation.allowMessage"), [
				{ text: t("reader.dictation.notNow"), style: "cancel" },
				{ text: t("reader.dictation.settings"), onPress: () => void Linking.openSettings() },
			])
		else if (problem === "busy")
			Alert.alert(t("reader.dictation.busyTitle"), t("reader.dictation.busyMessage"))
		else
			Alert.alert(t("reader.dictation.unsupportedTitle"), t("reader.dictation.unsupportedMessage"))
	}

	function stop() {
		if (active.current) void dictation?.stop()
	}

	function drop() {
		if (!active.current) return
		active.current = false
		setListening(false)
		void dictation?.stop()
	}

	return { available: dictation !== null, listening, start, stop, drop }
}
