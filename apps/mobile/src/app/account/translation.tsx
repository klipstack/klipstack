import { SymbolView } from "expo-symbols"
import { useCallback, useEffect, useState } from "react"
import {
	ActivityIndicator,
	Alert,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native"
import { listStyles, Row, Section } from "@/components/grouped-list"
import { useAuth } from "@/lib/auth"
import { t } from "@/lib/i18n"
import { type Colors, useColors } from "@/lib/theme"
import { languageName, type TranslationLanguages } from "@/lib/translation"

/**
 * The languages never translated (the reader reads them: no offer to translate), and those always
 * translated as they are saved, as the web's Settings › Features lists them. They are added from
 * the reader's translation bar; removing one puts it back to being offered.
 */
export default function TranslationLanguagesScreen() {
	const { state } = useAuth()
	const colors = useColors()
	const client = state.status === "signed-in" ? state.client : null
	const [languages, setLanguages] = useState<TranslationLanguages | "failed" | null>(null)

	const load = useCallback(() => {
		if (!client) return
		client.translationLanguages.get().then(setLanguages, () => setLanguages("failed"))
		// setLanguages never changes; listed because the React Compiler's lint can't tell here.
	}, [client, setLanguages])
	useEffect(load, [load])

	async function remove(language: string) {
		if (!client || !languages || languages === "failed") return
		// Gone at once, while the server forgets it.
		setLanguages({
			never: languages.never.filter((code) => code !== language),
			always: languages.always.filter((code) => code !== language),
		})
		try {
			setLanguages(await client.translationLanguages.set(language, "ask"))
		} catch {
			Alert.alert(t("account.translation.failed"), t("account.account.tryAgain"))
			load()
		}
	}

	return (
		<ScrollView
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={listStyles.content}
			contentInsetAdjustmentBehavior="automatic"
		>
			{languages === null ? (
				<ActivityIndicator color={colors.mutedFg} style={styles.loading} />
			) : languages === "failed" ? (
				<Section>
					<Row
						label={t("account.translation.loadFailed")}
						onPress={() => {
							setLanguages(null)
							load()
						}}
					/>
				</Section>
			) : (
				(["never", "always"] as const).map((choice) => (
					<Section
						key={choice}
						title={t(`account.translation.${choice}.title`)}
						footnote={t(`account.translation.${choice}.description`)}
					>
						{languages[choice].length === 0 ? (
							<Text style={[styles.empty, { color: colors.mutedFg }]}>
								{t(`account.translation.${choice}.empty`)}
							</Text>
						) : (
							languages[choice].map((code) => (
								<Language
									key={code}
									name={languageName(code)}
									onRemove={() => void remove(code)}
									colors={colors}
								/>
							))
						)}
					</Section>
				))
			)}
		</ScrollView>
	)
}

/** A language, and the button that takes it off its list. */
function Language({
	name,
	onRemove,
	colors,
}: {
	name: string
	onRemove: () => void
	colors: Colors
}) {
	return (
		<View style={styles.row}>
			<Text style={[styles.name, { color: colors.fg }]} numberOfLines={1}>
				{name}
			</Text>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t("account.translation.remove", { language: name })}
				hitSlop={10}
				onPress={onRemove}
				style={({ pressed }) => pressed && styles.pressed}
			>
				<SymbolView name="minus.circle.fill" tintColor={colors.danger} size={22} />
			</Pressable>
		</View>
	)
}

const styles = StyleSheet.create({
	loading: { paddingVertical: 24 },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingVertical: 12,
		paddingHorizontal: 16,
		minHeight: 48,
	},
	name: { fontSize: 17, flex: 1 },
	empty: { fontSize: 15, lineHeight: 20, paddingVertical: 12, paddingHorizontal: 16 },
	pressed: { opacity: 0.5 },
})
