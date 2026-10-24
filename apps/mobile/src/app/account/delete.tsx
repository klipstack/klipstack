import { KlipstackApiError } from "@klipstack/sdk"
import { useEffect, useState } from "react"
import {
	ActivityIndicator,
	Alert,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native"
import { listStyles } from "@/components/grouped-list"
import { SignInForm } from "@/components/sign-in-form"
import { useAuth } from "@/lib/auth"
import { errorMessage, t } from "@/lib/i18n"
import type { Session } from "@/lib/session-store"
import { fonts, useColors } from "@/lib/theme"
import { openOnTheWeb } from "@/lib/web-pages"

/** Whether what was typed is the account's email, as the server compares them. */
const confirms = (typed: string, email: string | null) =>
	!!email && typed.trim().toLowerCase() === email.toLowerCase()

/**
 * Deleting the account, as Settings on the web does it: typing the account's email to confirm,
 * and a sign-in from the last 30 minutes. The server says when that sign-in is too old; the app
 * then asks to sign in again, in a sheet with the sign-in screen's ways in, and deletes.
 */
export default function DeleteAccount() {
	const { state, apiUrl, signedInAgain, accountDeleted } = useAuth()
	const colors = useColors()
	const client = state.status === "signed-in" ? state.client : null
	const [email, setEmail] = useState<string | null>(null)
	const [typed, setTyped] = useState("")
	const [busy, setBusy] = useState(false)
	// The sheet that asks to sign in again.
	const [confirming, setConfirming] = useState(false)
	// What went wrong; `web` when only the web can delete it (this sign-in isn't the app's own).
	const [error, setError] = useState<{ message: string; web?: boolean } | null>(null)
	const ready = confirms(typed, email) && !busy

	useEffect(() => {
		void client?.me().then(
			(me) => setEmail(me.email),
			() => setError({ message: t("account.delete.loadFailed") }),
		)
	}, [client])

	async function remove(again = false): Promise<void> {
		if (!client) return
		setBusy(true)
		setError(null)
		try {
			await client.account.delete(typed.trim())
		} catch (e) {
			setBusy(false)
			if (e instanceof KlipstackApiError && e.code === "reauthentication_required" && !again)
				return setConfirming(true)
			setError({
				message: errorMessage(e),
				web: e instanceof KlipstackApiError && e.code === "forbidden",
			})
			return
		}
		await accountDeleted()
		Alert.alert(t("account.delete.deletedTitle"), t("account.delete.deletedMessage"))
	}

	async function signedIn(session: Session) {
		// Saved first: if that fails, the sheet stays open with the error.
		await signedInAgain(session)
		setConfirming(false)
		// The sheet lets anyone sign in: deleting goes on only for the same account. The client reads
		// the new session.
		const now = await client?.me()
		if (now && now.email.toLowerCase() !== email?.toLowerCase())
			return setError({
				message: t("account.delete.otherAccount", { email: now.email }),
			})
		await remove(true)
	}

	function confirm() {
		Alert.alert(t("account.delete.confirmTitle"), t("account.delete.confirmMessage"), [
			{ text: t("common.actions.cancel"), style: "cancel" },
			{ text: t("common.actions.delete"), style: "destructive", onPress: () => void remove() },
		])
	}

	return (
		<ScrollView
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={listStyles.content}
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
		>
			<Text style={[styles.lead, { color: colors.fg }]}>{t("account.delete.lead")}</Text>
			<Text style={[styles.body, { color: colors.mutedFg }]}>{t("account.delete.body")}</Text>
			<View style={styles.field}>
				<Text style={[styles.label, { color: colors.fg }]}>
					{t("account.delete.typeBefore")}
					{email ? <Text style={styles.strong}>{email}</Text> : t("account.delete.yourEmail")}
					{t("account.delete.typeAfter")}
				</Text>
				<TextInput
					accessibilityLabel={t("account.delete.fieldLabel")}
					value={typed}
					onChangeText={setTyped}
					placeholder={email ?? t("account.delete.email")}
					placeholderTextColor={colors.mutedFg}
					autoCapitalize="none"
					autoCorrect={false}
					autoComplete="off"
					keyboardType="email-address"
					textContentType="none"
					editable={!busy}
					returnKeyType="done"
					onSubmitEditing={() => ready && confirm()}
					style={[
						styles.input,
						{ color: colors.fg, backgroundColor: colors.card, borderColor: colors.border },
					]}
				/>
			</View>
			{error ? (
				<View style={styles.error}>
					<Text style={[styles.body, { color: colors.danger }]}>{error.message}</Text>
					{error.web ? (
						<Pressable
							accessibilityRole="link"
							onPress={() => openOnTheWeb(`${apiUrl}/settings/account`)}
						>
							<Text style={[styles.body, { color: colors.accent }]}>
								{t("account.delete.openWeb")}
							</Text>
						</Pressable>
					) : null}
				</View>
			) : null}
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ disabled: !ready, busy }}
				disabled={!ready}
				onPress={confirm}
				style={({ pressed }) => [
					styles.button,
					{ backgroundColor: colors.danger },
					(!ready || pressed) && styles.dim,
				]}
			>
				{busy ? (
					<ActivityIndicator color="#fff" />
				) : (
					<Text style={styles.buttonText}>{t("account.delete.button")}</Text>
				)}
			</Pressable>
			<Modal
				visible={confirming}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setConfirming(false)}
			>
				<View style={[styles.sheet, { backgroundColor: colors.bg }]}>
					<View style={styles.sheetBar}>
						<Text style={[styles.sheetTitle, { color: colors.fg }]}>
							{t("account.delete.sheetTitle")}
						</Text>
						<Pressable accessibilityRole="button" hitSlop={8} onPress={() => setConfirming(false)}>
							<Text style={[styles.cancel, { color: colors.accent }]}>
								{t("common.actions.cancel")}
							</Text>
						</Pressable>
					</View>
					<SignInForm
						apiUrl={apiUrl}
						onSession={signedIn}
						header={
							<Text style={[styles.body, styles.sheetLead, { color: colors.mutedFg }]}>
								{email ? t("account.delete.sheetLeadAs", { email }) : t("account.delete.sheetLead")}
							</Text>
						}
					/>
				</View>
			</Modal>
		</ScrollView>
	)
}

const styles = StyleSheet.create({
	lead: { fontFamily: fonts.displayText, fontSize: 21, lineHeight: 28 },
	body: { fontSize: 15, lineHeight: 21 },
	field: { gap: 8 },
	label: { fontSize: 15 },
	strong: { fontWeight: "600" },
	input: {
		fontSize: 17,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 12,
		paddingHorizontal: 14,
		paddingVertical: 12,
	},
	error: { gap: 6 },
	button: {
		borderRadius: 14,
		minHeight: 50,
		alignItems: "center",
		justifyContent: "center",
	},
	buttonText: { color: "#fff", fontSize: 17, fontWeight: "600" },
	dim: { opacity: 0.45 },
	sheet: { flex: 1 },
	sheetBar: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 20,
		paddingTop: 20,
	},
	sheetTitle: { fontFamily: fonts.displayText, fontSize: 21 },
	cancel: { fontSize: 17 },
	sheetLead: { marginBottom: 8 },
})
