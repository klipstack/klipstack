import type { KlipstackClient } from "@klipstack/sdk"
import { useFocusEffect } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native"
import { PasteButton } from "@/components/paste-button"
import { lookAtClipboard } from "@/lib/clipboard"
import { linkIn } from "@/lib/save-link"
import type { Colors } from "@/lib/theme"

/** For one copy, by the clipboard's change count. */
type Offer = { count: number } & (
	| { state: "offered" }
	| { state: "saving" }
	| { state: "saved"; created: boolean }
	| { state: "failed"; message: string }
)

/**
 * On Home, a link copied elsewhere (another app, or the Mac through Universal Clipboard), offered
 * for saving. It's found without reading the clipboard (`lookAtClipboard`), each time Home or the
 * app comes back, and while the card shows; the system's Paste button reads it and
 * saves it. Each copy is offered once; the card goes when it's saved or dismissed, or when the
 * link is no longer on the clipboard.
 */
export function ClipboardOffer({
	client,
	onSaved,
	colors,
}: {
	client: KlipstackClient | null
	onSaved: () => void
	colors: Colors
}) {
	const [offer, setOfferState] = useState<Offer | null>(null)
	// The same, for the callbacks below.
	const current = useRef<Offer | null>(null)
	const setOffer = useCallback((next: Offer | null) => {
		current.current = next
		setOfferState(next)
	}, [])

	// While saving, and while it says it saved, the card stays with that copy.
	const look = useCallback(() => {
		const now = current.current
		if (now?.state === "saving" || now?.state === "saved") return
		const count = lookAtClipboard(now?.count ?? null)
		if (count === null) setOffer(null)
		else if (count !== now?.count) setOffer({ state: "offered", count })
	}, [setOffer])

	useFocusEffect(
		useCallback(() => {
			look()
			const app = AppState.addEventListener("change", (appState) => {
				if (appState === "active") look()
			})
			// iOS says nothing to the app when another app, or the Mac, changes the clipboard: while
			// the card shows, it looks again every 2 seconds (a count and a type, not the contents).
			const timer = setInterval(() => {
				if (current.current) look()
			}, 2000)
			return () => {
				app.remove()
				clearInterval(timer)
			}
		}, [look]),
	)

	// Saved: it says so for a moment, then goes.
	useEffect(() => {
		if (offer?.state !== "saved") return
		const timer = setTimeout(() => setOffer(null), 2500)
		return () => clearTimeout(timer)
	}, [offer, setOffer])

	async function paste(text: string | null) {
		const now = current.current
		if (!client || !now || now.state === "saving" || now.state === "saved") return
		const { count } = now
		const link = text && linkIn(text)
		if (!link) {
			const message = text?.trim() ? "The clipboard holds no link." : "There's nothing to paste."
			return setOffer({ state: "failed", message, count })
		}
		setOffer({ state: "saving", count })
		try {
			const { created } = await client.articles.save({ url: link })
			setOffer({ state: "saved", created, count })
			onSaved()
		} catch (e) {
			setOffer({ state: "failed", message: e instanceof Error ? e.message : String(e), count })
		}
	}

	if (!offer) return null
	const open = offer.state === "offered" || offer.state === "failed"
	return (
		<View style={[styles.card, { backgroundColor: colors.muted }]}>
			<SymbolView
				name={offer.state === "saved" ? "checkmark.circle.fill" : "link"}
				tintColor={colors.accent}
				size={22}
			/>
			<View style={styles.text}>
				<Text style={[styles.title, { color: colors.fg }]}>
					{offer.state === "saved"
						? offer.created
							? "Saved to Klipstack"
							: "Already in Klipstack"
						: offer.state === "saving"
							? "Saving…"
							: "You copied a link"}
				</Text>
				{offer.state === "offered" ? (
					<Text style={[styles.note, { color: colors.mutedFg }]}>Paste it here to save it.</Text>
				) : offer.state === "failed" ? (
					<Text style={[styles.note, { color: colors.danger }]}>{offer.message}</Text>
				) : null}
			</View>
			{open ? <PasteButton onPaste={(text) => void paste(text)} colors={colors} /> : null}
			{offer.state === "saving" ? <ActivityIndicator color={colors.mutedFg} /> : null}
			{open ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Dismiss"
					hitSlop={10}
					onPress={() => setOffer(null)}
				>
					<SymbolView name="xmark" tintColor={colors.mutedFg} size={14} />
				</Pressable>
			) : null}
		</View>
	)
}

const styles = StyleSheet.create({
	card: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		marginHorizontal: 16,
		paddingVertical: 12,
		paddingHorizontal: 14,
		borderRadius: 14,
	},
	text: { flex: 1, gap: 2 },
	title: { fontSize: 16, fontWeight: "600" },
	note: { fontSize: 14, lineHeight: 19 },
})
