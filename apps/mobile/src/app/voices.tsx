import { Stack } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useEffect, useRef, useState } from "react"
import {
	ActivityIndicator,
	Alert,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native"
import { claimSpeech, ownsSpeech, releaseSpeech } from "@/lib/read-aloud"
import { loadSpeechPrefs, saveSpeechPrefs } from "@/lib/reader-files"
import { formatBytes, LANGUAGE_NAMES } from "@/lib/speech"
import { type Colors, useColors } from "@/lib/theme"
import { type LanguagePack, type SpeechLanguage, speech } from "../../modules/klip-speech"

const SAMPLES: Record<SpeechLanguage, string> = {
	en: "This is how I sound, reading your articles aloud.",
	es: "Así sueno cuando leo tus artículos en voz alta.",
}

/**
 * The voices for reading aloud: each language's download (Kokoro's model, which languages share,
 * a pronunciation dictionary and its voices), the voice chosen for it, and a sample of each.
 */
export default function Voices() {
	const colors = useColors()
	const [packs, setPacks] = useState<LanguagePack[] | null>(null)
	const [prefs, setPrefs] = useState(loadSpeechPrefs)
	const [downloading, setDownloading] = useState<{
		language: SpeechLanguage
		received: number
		total: number
	} | null>(null)
	// Progress events count only while this screen downloads: the last can arrive after it's done.
	const active = useRef(false)
	// The sample playing is ours: a reader reading aloud stops for it.
	const [me] = useState(() => ({ release: () => {} }))

	const refresh = useCallback(() => {
		void speech?.languages().then(setPacks)
	}, [])

	useEffect(() => {
		refresh()
		const subscription = speech?.addListener("onDownload", (event) => {
			if (active.current) setDownloading(event)
		})
		return () => {
			subscription?.remove()
			if (ownsSpeech(me)) {
				releaseSpeech(me)
				void speech?.stop()
			}
		}
	}, [refresh, me])

	async function download(pack: LanguagePack) {
		if (!speech) return
		setDownloading({ language: pack.language, received: 0, total: pack.missingBytes })
		active.current = true
		try {
			await speech.download(pack.language)
		} catch (e) {
			Alert.alert("Download stopped", e instanceof Error ? e.message : String(e))
		} finally {
			active.current = false
			setDownloading(null)
			refresh()
		}
	}

	function remove(pack: LanguagePack) {
		Alert.alert(
			`Delete the ${LANGUAGE_NAMES[pack.language]} voices?`,
			"You can download them again later.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Delete",
					style: "destructive",
					onPress: () => void speech?.remove(pack.language).then(refresh),
				},
			],
		)
	}

	function choose(language: SpeechLanguage, voice: string) {
		const next = { ...prefs, voices: { ...prefs.voices, [language]: voice } }
		setPrefs(next)
		saveSpeechPrefs(next)
		claimSpeech(me)
		void speech
			?.speak({
				sentences: [SAMPLES[language]],
				pauses: [0.3],
				start: 0,
				language,
				voice,
				rate: prefs.speed,
				title: "Voice sample",
				artist: "Klipstack",
			})
			.catch((e: unknown) =>
				Alert.alert("Couldn't play", e instanceof Error ? e.message : String(e)),
			)
	}

	return (
		<ScrollView
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={styles.content}
			contentInsetAdjustmentBehavior="automatic"
		>
			<Stack.Screen options={{ title: "Voices" }} />
			{!speech ? (
				<Text style={[styles.note, { color: colors.mutedFg }]}>This build can't read aloud.</Text>
			) : !packs ? (
				<ActivityIndicator color={colors.mutedFg} />
			) : (
				packs.map((pack) => (
					<Language
						key={pack.language}
						pack={pack}
						chosen={prefs.voices[pack.language] ?? pack.voices[0]?.id}
						downloading={downloading?.language === pack.language ? downloading : null}
						busy={downloading !== null}
						onDownload={() => void download(pack)}
						onCancel={() => void speech?.cancelDownload()}
						onRemove={() => remove(pack)}
						onChoose={(voice) => choose(pack.language, voice)}
						colors={colors}
					/>
				))
			)}
			<Text style={[styles.note, { color: colors.mutedFg }]}>
				Klipstack reads aloud on this iPhone, with Kokoro, an open voice model. Nothing leaves the
				phone, and it works offline. English and Spanish share most of the download.
			</Text>
		</ScrollView>
	)
}

function Language({
	pack,
	chosen,
	downloading,
	busy,
	onDownload,
	onCancel,
	onRemove,
	onChoose,
	colors,
}: {
	pack: LanguagePack
	chosen: string | undefined
	downloading: { received: number; total: number } | null
	busy: boolean
	onDownload: () => void
	onCancel: () => void
	onRemove: () => void
	onChoose: (voice: string) => void
	colors: Colors
}) {
	const share = downloading?.total ? downloading.received / downloading.total : 0
	return (
		<View style={styles.section}>
			<Text style={[styles.heading, { color: colors.mutedFg }]}>
				{LANGUAGE_NAMES[pack.language].toUpperCase()}
			</Text>
			<View style={[styles.card, { backgroundColor: colors.muted }]}>
				{pack.installed ? (
					<>
						{pack.voices.map((voice, i) => (
							<Pressable
								key={voice.id}
								accessibilityRole="button"
								accessibilityState={{ selected: voice.id === chosen }}
								onPress={() => onChoose(voice.id)}
								style={({ pressed }) => [
									styles.row,
									i > 0 && {
										borderTopColor: colors.border,
										borderTopWidth: StyleSheet.hairlineWidth,
									},
									pressed && styles.pressed,
								]}
							>
								<Text style={[styles.label, { color: colors.fg }]}>{voice.name}</Text>
								{voice.id === chosen ? (
									<SymbolView
										name="checkmark"
										tintColor={colors.accent}
										size={17}
										weight="semibold"
									/>
								) : null}
							</Pressable>
						))}
						<Pressable
							accessibilityRole="button"
							onPress={onRemove}
							style={({ pressed }) => [
								styles.row,
								{ borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
								pressed && styles.pressed,
							]}
						>
							<Text style={[styles.label, { color: colors.danger }]}>Delete voices</Text>
						</Pressable>
					</>
				) : downloading ? (
					<View style={styles.row}>
						<View style={styles.grow}>
							<Text style={[styles.label, { color: colors.fg }]}>
								Downloading… {Math.floor(share * 100)}%
							</Text>
							<View style={[styles.track, { backgroundColor: colors.border }]}>
								<View
									style={[
										styles.fill,
										{ backgroundColor: colors.accent, width: `${share * 100}%` },
									]}
								/>
							</View>
						</View>
						<Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
							<Text style={[styles.label, { color: colors.accent }]}>Cancel</Text>
						</Pressable>
					</View>
				) : (
					<Pressable
						accessibilityRole="button"
						disabled={busy}
						onPress={onDownload}
						style={({ pressed }) => [styles.row, (pressed || busy) && styles.pressed]}
					>
						<Text style={[styles.label, { color: colors.accent }]}>Download</Text>
						<Text style={[styles.label, { color: colors.mutedFg }]}>
							{formatBytes(pack.missingBytes)}
						</Text>
					</Pressable>
				)}
			</View>
			{pack.installed ? (
				<Text style={[styles.footnote, { color: colors.mutedFg }]}>
					Tap a voice to hear it. The one checked reads your {LANGUAGE_NAMES[pack.language]}{" "}
					articles.
				</Text>
			) : null}
		</View>
	)
}

const styles = StyleSheet.create({
	content: { padding: 16, gap: 8 },
	section: { gap: 6, marginBottom: 16 },
	heading: { fontSize: 13, marginLeft: 16 },
	card: { borderRadius: 12, overflow: "hidden" },
	row: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		paddingVertical: 12,
		paddingHorizontal: 16,
		minHeight: 44,
	},
	grow: { flex: 1, gap: 8 },
	label: { fontSize: 17 },
	track: { height: 4, borderRadius: 2, overflow: "hidden" },
	fill: { height: 4 },
	footnote: { fontSize: 13, marginHorizontal: 16 },
	note: { fontSize: 13, marginHorizontal: 16, lineHeight: 18 },
	pressed: { opacity: 0.5 },
})
