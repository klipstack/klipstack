import { StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useColors } from "@/lib/theme"

/** Shown when the API answers `client_outdated`: this version no longer works with the server. */
export default function Update() {
	const colors = useColors()
	return (
		<SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
			<View style={styles.body}>
				<Text style={[styles.title, { color: colors.fg }]}>Update Klipstack</Text>
				<Text style={[styles.text, { color: colors.mutedFg }]}>
					This version of the app no longer works. Install the latest version to keep using
					Klipstack.
				</Text>
			</View>
		</SafeAreaView>
	)
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	body: { flex: 1, justifyContent: "center", paddingHorizontal: 32, gap: 12 },
	title: { fontSize: 28, fontWeight: "700" },
	text: { fontSize: 17, lineHeight: 24 },
})
