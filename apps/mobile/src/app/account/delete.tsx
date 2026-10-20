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
			() => setError({ message: "Couldn't load your account. Go back and try again." }),
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
				message: e instanceof Error ? e.message : String(e),
				web: e instanceof KlipstackApiError && e.code === "forbidden",
			})
			return
		}
		await accountDeleted()
		Alert.alert("Account deleted", "Your account and everything in it are gone.")
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
				message: `You signed in as ${now.email}, so nothing was deleted. The app now uses that account.`,
			})
		await remove(true)
	}

	function confirm() {
		Alert.alert(
			"Delete your account?",
			"Everything in it is deleted for good. This can't be undone.",
			[
				{ text: "Cancel", style: "cancel" },
				{ text: "Delete", style: "destructive", onPress: () => void remove() },
			],
		)
	}

	return (
		<ScrollView
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={listStyles.content}
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
		>
			<Text style={[styles.lead, { color: colors.fg }]}>
				This deletes your account and everything in it: articles, highlights, notes, tags, feeds and
				editions. It can't be undone.
			</Text>
			<Text style={[styles.body, { color: colors.mutedFg }]}>
				To keep your library, export it first from Account. Klipstack on your other devices is
				signed out.
			</Text>
			<View style={styles.field}>
				<Text style={[styles.label, { color: colors.fg }]}>
					Type {email ? <Text style={styles.strong}>{email}</Text> : "your email"} to confirm
				</Text>
				<TextInput
					accessibilityLabel="Your email, to confirm"
					value={typed}
					onChangeText={setTyped}
					placeholder={email ?? "Email"}
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
							<Text style={[styles.body, { color: colors.accent }]}>Open Settings on the web</Text>
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
					<Text style={styles.buttonText}>Delete account</Text>
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
						<Text style={[styles.sheetTitle, { color: colors.fg }]}>Confirm it's you</Text>
						<Pressable accessibilityRole="button" hitSlop={8} onPress={() => setConfirming(false)}>
							<Text style={[styles.cancel, { color: colors.accent }]}>Cancel</Text>
						</Pressable>
					</View>
					<SignInForm
						apiUrl={apiUrl}
						onSession={signedIn}
						header={
							<Text style={[styles.body, styles.sheetLead, { color: colors.mutedFg }]}>
								Deleting the account needs a sign-in from the last 30 minutes. Sign in again
								{email ? ` as ${email}` : ""}, any way you like.
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
