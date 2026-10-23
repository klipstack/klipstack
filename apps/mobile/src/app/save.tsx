import { router, Stack } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { PasteButton } from "@/components/paste-button"
import { useAuth } from "@/lib/auth"
import { markClipboardSeen } from "@/lib/clipboard"
import { errorMessage } from "@/lib/i18n"
import { linkIn } from "@/lib/save-link"
import { useColors } from "@/lib/theme"

type Status =
	| { state: "editing" }
	| { state: "saving" }
	| { state: "saved"; created: boolean }
	| { state: "failed"; message: string }

/**
 * Saves a link typed or pasted, from the tabs' + button: the share sheet's job, for a link that
 * isn't in another app's page (copied, or read somewhere else). Says it's saved and closes; the
 * reader stays where they were.
 */
export default function SaveLink() {
	const { state } = useAuth()
	const colors = useColors()
	const client = state.status === "signed-in" ? state.client : null
	const [text, setText] = useState("")
	const [status, setStatus] = useState<Status>({ state: "editing" })
	// The link came from the clipboard: once saved, it isn't offered on Home.
	const pasted = useRef(false)
	const link = linkIn(text)
	const busy = status.state === "saving" || status.state === "saved"

	useEffect(() => {
		if (status.state !== "saved") return
		const timer = setTimeout(() => router.back(), 900)
		return () => clearTimeout(timer)
	}, [status])

	async function save() {
		if (!client || !link || busy) return
		setStatus({ state: "saving" })
		try {
			const { created } = await client.articles.save({ url: link })
			if (pasted.current) markClipboardSeen()
			setStatus({ state: "saved", created })
		} catch (e) {
			setStatus({ state: "failed", message: errorMessage(e) })
		}
	}

	function paste(value: string | null) {
		if (busy) return
		if (!value?.trim()) return setStatus({ state: "failed", message: "There's nothing to paste." })
		pasted.current = true
		setText(linkIn(value) ?? value.trim())
		setStatus({ state: "editing" })
	}

	return (
		<>
			<Stack.Toolbar placement="left">
				<Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
			</Stack.Toolbar>
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Button
					variant="done"
					tintColor={colors.accent}
					disabled={!link || busy}
					onPress={() => void save()}
				>
					Save
				</Stack.Toolbar.Button>
			</Stack.Toolbar>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				keyboardShouldPersistTaps="handled"
				style={{ backgroundColor: colors.bg }}
				contentContainerStyle={styles.page}
			>
				<View style={[styles.field, { backgroundColor: colors.muted }]}>
					<SymbolView
						name="link"
						tintColor={colors.mutedFg}
						size={17}
						accessibilityElementsHidden
					/>
					<TextInput
						accessibilityLabel="Link to save"
						value={text}
						onChangeText={(value) => {
							pasted.current = false
							setText(value)
							setStatus({ state: "editing" })
						}}
						onSubmitEditing={() => void save()}
						editable={!busy}
						autoFocus
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
						textContentType="URL"
						returnKeyType="go"
						clearButtonMode="while-editing"
						placeholder="https://"
						placeholderTextColor={colors.mutedFg}
						style={[styles.input, { color: colors.fg }]}
					/>
				</View>
				<View style={styles.row}>
					<PasteButton onPaste={paste} colors={colors} />
					<View style={styles.status}>
						{status.state === "saving" ? (
							<>
								<ActivityIndicator color={colors.mutedFg} />
								<Text style={[styles.statusText, { color: colors.mutedFg }]}>Saving…</Text>
							</>
						) : status.state === "saved" ? (
							<>
								<SymbolView
									name="checkmark.circle.fill"
									tintColor={colors.accent}
									size={20}
									accessibilityElementsHidden
								/>
								<Text style={[styles.statusText, { color: colors.fg }]}>
									{status.created ? "Saved to Klipstack" : "Already in Klipstack"}
								</Text>
							</>
						) : status.state === "failed" ? (
							<Text style={[styles.statusText, { color: colors.danger }]}>{status.message}</Text>
						) : text.trim() && !link ? (
							<Text style={[styles.statusText, { color: colors.mutedFg }]}>
								That isn't a web address.
							</Text>
						) : null}
					</View>
				</View>
			</ScrollView>
		</>
	)
}

const styles = StyleSheet.create({
	page: { padding: 16, gap: 16 },
	field: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingHorizontal: 12,
		borderRadius: 12,
		height: 48,
	},
	input: { flex: 1, fontSize: 17, height: 48 },
	row: { flexDirection: "row", alignItems: "center", gap: 12 },
	status: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
	statusText: { flexShrink: 1, fontSize: 15, lineHeight: 20 },
})
