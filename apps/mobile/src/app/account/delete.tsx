import { KlipstackApiError } from "@klipstack/sdk"
import * as WebBrowser from "expo-web-browser"
import { useEffect, useState } from "react"
import {
	ActivityIndicator,
	Alert,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native"
import { listStyles } from "@/components/grouped-list"
import { useAuth } from "@/lib/auth"
import { fonts, useColors } from "@/lib/theme"

/** Whether what was typed is the account's email, as the server compares them. */
const confirms = (typed: string, email: string | null) =>
	!!email && typed.trim().toLowerCase() === email.toLowerCase()

/**
 * Deleting the account, as Settings on the web does it: typing the account's email to confirm,
 * and a sign-in from the last 30 minutes. The server says when that sign-in is too old; the app
 * then signs in again, password and all, and deletes.
 */
export default function DeleteAccount() {
	const { state, apiUrl, signInAgain, accountDeleted } = useAuth()
	const colors = useColors()
	const client = state.status === "signed-in" ? state.client : null
	const [email, setEmail] = useState<string | null>(null)
	const [typed, setTyped] = useState("")
	const [busy, setBusy] = useState(false)
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
				return askToSignInAgain()
			setError({
				message: e instanceof Error ? e.message : String(e),
				web: e instanceof KlipstackApiError && e.code === "forbidden",
			})
			return
		}
		await accountDeleted()
		Alert.alert("Account deleted", "Your account and everything in it are gone.")
	}

	function askToSignInAgain() {
		Alert.alert(
			"Sign in again",
			"To delete the account, sign in again with your password first: it needs a sign-in from the last 30 minutes. Without a password, delete it on the web.",
			[
				{ text: "Cancel", style: "cancel" },
				// An account without a password (Google, GitHub, emailed links) can't sign in again here.
				{
					text: "Use the web",
					onPress: () => void WebBrowser.openBrowserAsync(`${apiUrl}/settings/account`),
				},
				{
					text: "Sign in",
					onPress: async () => {
						try {
							if (!(await signInAgain())) return
							// The sheet lets anyone sign in: deleting goes on only for the same account.
							const now = await client?.me()
							if (now && now.email.toLowerCase() !== email?.toLowerCase())
								return setError({
									message: `You signed in as ${now.email}, so nothing was deleted. The app now uses that account.`,
								})
							await remove(true)
						} catch (e) {
							setError({ message: e instanceof Error ? e.message : String(e) })
						}
					},
				},
			],
		)
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
							onPress={() => void WebBrowser.openBrowserAsync(`${apiUrl}/settings/account`)}
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
})
