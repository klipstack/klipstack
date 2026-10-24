import { Linking, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { t } from "@/lib/i18n"
import { useColors } from "@/lib/theme"

/** The app's page in the App Store (App Store Connect → App Information → Apple ID). */
const APP_STORE_URL = "https://apps.apple.com/app/id6824513146"

/** Shown when the API answers `client_outdated`: this version no longer works with the server. */
export default function Update() {
	const colors = useColors()
	return (
		<SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
			<View style={styles.body}>
				<Text style={[styles.title, { color: colors.fg }]}>{t("account.update.title")}</Text>
				<Text style={[styles.text, { color: colors.mutedFg }]}>{t("account.update.text")}</Text>
				<Pressable
					accessibilityRole="button"
					onPress={() => void Linking.openURL(APP_STORE_URL)}
					style={[styles.button, { backgroundColor: colors.accent }]}
				>
					<Text style={[styles.buttonText, { color: colors.accentFg }]}>
						{t("account.update.button")}
					</Text>
				</Pressable>
			</View>
		</SafeAreaView>
	)
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	body: { flex: 1, justifyContent: "center", paddingHorizontal: 32, gap: 12 },
	title: { fontSize: 28, fontWeight: "700" },
	text: { fontSize: 17, lineHeight: 24 },
	button: { marginTop: 16, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
	buttonText: { fontSize: 17, fontWeight: "600" },
})
