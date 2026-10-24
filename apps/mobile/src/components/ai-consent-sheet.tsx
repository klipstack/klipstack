import { SymbolView } from "expo-symbols"
import {
	ActivityIndicator,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native"
import { AI_CONSENT } from "@/lib/ai"
import { t } from "@/lib/i18n"
import { type Colors, fonts } from "@/lib/theme"
import { openOnTheWeb } from "@/lib/web-pages"

/**
 * Before the account's first question to the AI (Explain, Define, Ask, the brief, the chat): what
 * is sent, to whom, and that nothing is until the reader asks. Continue records the choice on the
 * account (`PUT /ai/consent`); Not Now sends nothing, and the next question asks again.
 */
export function AiConsentSheet({
	visible,
	busy,
	failed,
	privacyUrl,
	onContinue,
	onClose,
	onDismiss,
	colors,
}: {
	visible: boolean
	/** The choice is being recorded. */
	busy: boolean
	/** Recording it failed: nothing was sent. */
	failed: boolean
	privacyUrl: string
	onContinue: () => void
	onClose: () => void
	/** After the sheet is gone, however it was closed. */
	onDismiss: () => void
	colors: Colors
}) {
	return (
		<Modal
			visible={visible}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={onClose}
			onDismiss={onDismiss}
		>
			<ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.sheet}>
				<SymbolView
					name="sparkles"
					tintColor={colors.accent}
					size={34}
					accessibilityElementsHidden
				/>
				<Text accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>
					{AI_CONSENT.title}
				</Text>
				<Text style={[styles.body, { color: colors.fg }]}>{AI_CONSENT.sent}</Text>
				<Text style={[styles.body, { color: colors.mutedFg }]}>{AI_CONSENT.when}</Text>
				<Pressable accessibilityRole="link" onPress={() => openOnTheWeb(privacyUrl)} hitSlop={8}>
					<Text style={[styles.link, { color: colors.accent }]}>{t("ai.consent.privacy")}</Text>
				</Pressable>
				<View style={styles.actions}>
					{failed ? (
						<Text style={[styles.failed, { color: colors.danger }]} accessibilityRole="alert">
							{t("ai.consent.failed")}
						</Text>
					) : null}
					<Pressable
						accessibilityRole="button"
						accessibilityState={{ busy, disabled: busy }}
						disabled={busy}
						onPress={onContinue}
						style={({ pressed }) => [
							styles.button,
							{ backgroundColor: colors.accent },
							(pressed || busy) && styles.pressed,
						]}
					>
						{busy ? (
							<ActivityIndicator color={colors.accentFg} />
						) : (
							<Text style={[styles.buttonText, { color: colors.accentFg }]}>
								{t("ai.consent.continue")}
							</Text>
						)}
					</Pressable>
					<Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.notNow}>
						<Text style={[styles.notNowText, { color: colors.accent }]}>
							{t("ai.consent.notNow")}
						</Text>
					</Pressable>
				</View>
			</ScrollView>
		</Modal>
	)
}

const styles = StyleSheet.create({
	sheet: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 48, paddingBottom: 40, gap: 16 },
	title: { fontFamily: fonts.display, fontSize: 28 },
	body: { fontSize: 17, lineHeight: 24 },
	link: { fontSize: 17 },
	actions: { marginTop: "auto", gap: 12 },
	failed: { fontSize: 15, textAlign: "center" },
	button: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
	pressed: { opacity: 0.7 },
	buttonText: { fontSize: 17, fontWeight: "600" },
	notNow: { alignItems: "center", paddingVertical: 8 },
	notNowText: { fontSize: 17 },
})
