import type { StarterLanguage } from "@klipstack/sdk"
import { Stack, useFocusEffect } from "expo-router"
import type { NativeStackHeaderItem } from "expo-router/native-stack"
import { useCallback, useRef, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { Paper } from "@/components/paper"
import { StarterGuide, StarterShelf, useAddStarter } from "@/components/starter-texts"
import { useAuth } from "@/lib/auth"
import { canUseOffline, keepStarter, keptStarter, OFFLINE_NOTE } from "@/lib/offline"
import {
	LANGUAGE_NAMES,
	STARTER_DESCRIPTION,
	type StarterShelves,
	TOPIC_NAMES,
} from "@/lib/starter-texts"
import { fonts, useColors } from "@/lib/theme"

const LANGUAGES: StarterLanguage[] = ["en", "es"]

/**
 * Every starter text, as the web's Discover page (/texts): the guide, then a shelf per topic, in
 * one language at a time, the reader's unless they switch. The guide comes first for a reader new
 * to Klipstack, last once they have it or know their way around. A tap on a book adds it and opens
 * it, or opens the reader's copy. From Home's empty state and the Library. Each language's shelves
 * are kept for offline.
 */
export default function Discover() {
	const { state } = useAuth()
	const client = state.status === "signed-in" ? state.client : null
	const colors = useColors()
	// The language asked for; until then, the reader's (the server's default).
	const [asked, setAsked] = useState<StarterLanguage | null>(null)
	const [answer, setAnswer] = useState<StarterShelves | null>(null)
	const [error, setError] = useState<string | null>(null)
	const { adding, open } = useAddStarter(client)
	const latest = useRef(0)

	const load = useCallback(
		async (language: StarterLanguage | null) => {
			if (!client) return
			const mine = ++latest.current
			try {
				const shelves = await client.starterTexts.list(language ?? undefined)
				if (mine !== latest.current) return
				setAnswer(shelves)
				setError(null)
				keepStarter(`starter-${shelves.language}`, shelves)
			} catch (e) {
				if (mine !== latest.current) return
				if (canUseOffline(e)) {
					// None asked: the shelves kept in the reader's own language.
					const kept = language
						? keptStarter<StarterShelves>(`starter-${language}`)
						: LANGUAGES.map((l) => keptStarter<StarterShelves>(`starter-${l}`)).find(
								(k) => k && k.language === k.readerLanguage,
							)
					if (kept) setAnswer(kept)
					return setError(OFFLINE_NOTE)
				}
				setError(e instanceof Error ? e.message : String(e))
			}
		},
		[client],
	)
	// Again on each return: the texts read since carry their ribbons.
	useFocusEffect(
		useCallback(() => {
			void load(asked)
		}, [load, asked]),
	)

	const shown = answer?.language ?? asked
	return (
		<Paper>
			<Stack.Screen
				options={{
					// As the tabs' first screens: a large title over the page's paper, no line under it.
					headerLargeTitle: true,
					headerShadowVisible: false,
					headerLargeTitleShadowVisible: false,
					unstable_headerRightItems: () => [
						languageMenu(shown, colors.accent, (language) => {
							setAsked(language)
							// What was kept for it shows at once, offline too; the server's answer follows.
							const kept = keptStarter<StarterShelves>(`starter-${language}`)
							if (kept) setAnswer(kept)
						}),
					],
				}}
			/>
			<ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
				{error ? (
					<Text style={[styles.inset, styles.note, { color: colors.mutedFg }]}>{error}</Text>
				) : null}
				{!answer ? (
					error ? null : (
						<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
					)
				) : (
					<>
						{answer.guideFirst ? (
							<View style={styles.inset}>
								<StarterGuide item={answer.guide} adding={adding} onOpen={open} colors={colors} />
							</View>
						) : null}
						<Text style={[styles.inset, styles.description, { color: colors.mutedFg }]}>
							{STARTER_DESCRIPTION}
						</Text>
						{answer.shelves.map(({ topic, items }) => (
							<View key={topic} style={styles.shelf}>
								<View style={styles.inset}>
									<Text accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>
										{TOPIC_NAMES[topic]?.title ?? topic}
									</Text>
									{TOPIC_NAMES[topic] ? (
										<Text style={[styles.topicLine, { color: colors.mutedFg }]}>
											{TOPIC_NAMES[topic].description}
										</Text>
									) : null}
								</View>
								<StarterShelf
									items={items}
									readerLanguage={answer.readerLanguage}
									wide
									adding={adding}
									onOpen={open}
									colors={colors}
								/>
							</View>
						))}
						{answer.guideFirst ? null : (
							<View style={[styles.inset, styles.guideLast]}>
								<StarterGuide item={answer.guide} adding={adding} onOpen={open} colors={colors} />
							</View>
						)}
					</>
				)}
			</ScrollView>
		</Paper>
	)
}

/**
 * Which language's texts the screen shows: the header's menu, each language by its own name, the
 * one shown ticked.
 */
function languageMenu(
	shown: StarterLanguage | null,
	tint: string,
	onPick: (language: StarterLanguage) => void,
): NativeStackHeaderItem {
	return {
		type: "menu",
		label: "Language",
		accessibilityLabel: shown
			? `Language of the texts: ${LANGUAGE_NAMES[shown]}`
			: "Language of the texts",
		tintColor: tint,
		icon: { type: "sfSymbol", name: "globe" },
		menu: {
			title: "Language of the texts",
			items: LANGUAGES.map((language) => ({
				type: "action" as const,
				label: LANGUAGE_NAMES[language],
				state: language === shown ? ("on" as const) : ("off" as const),
				onPress: () => onPick(language),
			})),
		},
	}
}

const styles = StyleSheet.create({
	page: { paddingBottom: 48 },
	inset: { paddingHorizontal: 16 },
	loading: { marginTop: 48 },
	note: { marginBottom: 12, fontSize: 14, lineHeight: 20 },
	description: { marginTop: 16, fontSize: 14, lineHeight: 20 },
	shelf: { marginTop: 28, gap: 6 },
	title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28 },
	topicLine: { fontSize: 14, lineHeight: 19 },
	guideLast: { marginTop: 36 },
})
