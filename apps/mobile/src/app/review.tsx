import { type ArticleSummary, KlipstackApiError } from "@klipstack/sdk"
import { router, Stack, useFocusEffect } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useRef, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useImageHeaders } from "@/components/article-card"
import { ReviewDeck, type ReviewDeckHandle } from "@/components/review-deck"
import { settled, showToast, track } from "@/lib/article-changes"
import { useAuth } from "@/lib/auth"
import {
	endsPage,
	leftText,
	putBack,
	reloaded,
	REVIEW_CHANGES,
	type ReviewAction,
	reviewNotice,
	spanText,
	toDecide,
} from "@/lib/review"
import { type Colors, useColors } from "@/lib/theme"

/** Room at the bottom for the app's toast (`ToastHost`), so it never covers the buttons. */
const TOAST_ROOM = 61 + 52

type Page = { items: ArticleSummary[]; more: boolean; afterDays: number; keepDays: number }

/**
 * Old saves never opened, the oldest first, as the web's /library/review, one at a time: swipe
 * right or tap Keep to keep one, swipe left or tap Archive to archive it, or delete it. Every
 * change has its undo. The header's menu keeps or archives all those left in the page at once.
 * Opening one to read takes it out of the review: the review loads again on the way back.
 */
export default function Review() {
	const { state } = useAuth()
	const client = state.status === "signed-in" ? state.client : null
	const colors = useColors()
	const headers = useImageHeaders()
	const insets = useSafeAreaInsets()
	const deck = useRef<ReviewDeckHandle>(null)
	const [page, setPage] = useState<Page | null>(null)
	// Decided here: out of the review at once, back if the server refuses or on undo.
	const [decided, setDecided] = useState<ReadonlySet<string>>(new Set())
	const [error, setError] = useState<string | null>(null)
	// Decided and undone since the last reload asked: its answer may not show them yet.
	const since = useRef({ decided: new Set<string>(), undone: new Map<string, ArticleSummary>() })

	const load = useCallback(async () => {
		if (!client) return
		try {
			// After the changes on their way: the server then leaves them out.
			await settled()
			since.current = { decided: new Set(), undone: new Map() }
			const answer = await client.review.list()
			const { decided: now, undone } = since.current
			const shown = reloaded(answer.items, { decided: now, undone: [...undone.values()] })
			setPage({ ...answer, items: shown.items })
			setDecided(shown.decided)
			setError(null)
		} catch (e) {
			setError(
				// A server before the review.
				e instanceof KlipstackApiError && e.status === 404
					? "Your Klipstack server doesn't have this yet."
					: e instanceof Error
						? e.message
						: String(e),
			)
		}
	}, [client])
	useFocusEffect(
		useCallback(() => {
			void load()
		}, [load]),
	)

	const left = page ? toDecide(page.items, decided) : []
	const [current, next] = left
	// The page is done and more are waiting: the next ones are on their way (`act`).
	const exhausted = page !== null && left.length === 0 && page.more

	const decide = (add: boolean, ids: string[]) => {
		for (const id of ids) {
			if (add) since.current.decided.add(id)
			else since.current.decided.delete(id)
		}
		setDecided((now) => {
			const out = new Set(now)
			for (const id of ids) {
				if (add) out.add(id)
				else out.delete(id)
			}
			return out
		})
	}

	const undo = (articles: ArticleSummary[], run: () => Promise<{ conflicts: string[] }>) => {
		const ids = articles.map((a) => a.id)
		decide(false, ids)
		for (const a of articles) since.current.undone.set(a.id, a)
		setPage((shown) => shown && { ...shown, items: putBack(shown.items, articles) })
		// Other lists load again once it lands.
		track(run()).then(
			({ conflicts }) => {
				// A reload on its way may have left it out: it's back on the server now.
				setPage((shown) => shown && { ...shown, items: putBack(shown.items, articles) })
				// The same page was saved again since: it stays in the trash, out of the review.
				if (!conflicts.length) return
				decide(true, conflicts)
				showToast({ message: "Saved again since, so it stays in the trash." })
			},
			() => {
				decide(true, ids)
				showToast({ message: "Couldn't undo it: it's been too long, or you're offline." })
			},
		)
	}

	const act = async (action: ReviewAction, articles: ArticleSummary[]) => {
		if (!client || !articles.length) return
		const ids = articles.map((a) => a.id)
		// The last of the page: once it lands, the next ones.
		const last = endsPage(left, ids, page?.more === true)
		decide(true, ids)
		try {
			let count: number
			let back: (() => Promise<{ conflicts: string[] }>) | null = null
			if (action === "delete") {
				const { trashed } = await track(client.articles.trash(ids))
				count = trashed.length
				back = async () => {
					const { alreadySaved } = await client.articles.restore(ids)
					return { conflicts: alreadySaved.map((a) => a.id) }
				}
			} else {
				const answer = await track(client.articles.update(ids, REVIEW_CHANGES[action]))
				count = answer.items.length
				const token = answer.undo?.[0]
				if (token)
					back = async () => {
						await client.articles.undo(token)
						return { conflicts: [] }
					}
			}
			if (last) void load()
			// Gone since (deleted elsewhere): out of the review all the same, with nothing to say.
			if (count === 0) return
			showToast({
				message: reviewNotice(action, articles.length === 1 ? 1 : count),
				action: back ? { label: "Undo", run: () => undo(articles, back) } : undefined,
			})
		} catch {
			decide(false, ids)
			showToast({ message: "Nothing changed. Try again." })
		}
	}

	const all = left.length
	return (
		<View style={[styles.page, { backgroundColor: colors.bg }]}>
			<Stack.Screen options={{ title: "Old Saves" }} />
			{all > 1 ? (
				<Stack.Toolbar placement="right">
					<Stack.Toolbar.Menu
						icon="ellipsis.circle"
						accessibilityLabel="All of them"
						tintColor={colors.accent}
					>
						<Stack.Toolbar.MenuAction icon="archivebox" onPress={() => void act("archive", left)}>
							{page?.more ? `Archive the Next ${all}` : `Archive All ${all}`}
						</Stack.Toolbar.MenuAction>
						<Stack.Toolbar.MenuAction icon="checkmark" onPress={() => void act("keep", left)}>
							{page?.more ? `Keep the Next ${all}` : `Keep All ${all}`}
						</Stack.Toolbar.MenuAction>
					</Stack.Toolbar.Menu>
				</Stack.Toolbar>
			) : null}
			{page ? (
				<Text style={[styles.intro, { color: colors.mutedFg }]}>
					Saved more than {spanText(page.afterDays)} ago, never opened. Archived articles stay in
					your archive and in search. Kept ones won't come back here for {spanText(page.keepDays)}.
				</Text>
			) : null}
			{current ? (
				<>
					<Text style={[styles.left, { color: colors.mutedFg }]} accessibilityLiveRegion="polite">
						{leftText(all, page?.more ?? false)}
					</Text>
					<View style={styles.deck}>
						<ReviewDeck
							ref={deck}
							current={current}
							next={next}
							onDecide={(action, item) => void act(action, [item])}
							colors={colors}
							headers={headers}
						/>
					</View>
					<View style={[styles.buttons, { marginBottom: insets.bottom + TOAST_ROOM }]}>
						<RoundButton
							label="Archive"
							icon="archivebox"
							onPress={() => deck.current?.decide("archive")}
							colors={colors}
						/>
						<RoundButton
							label="Delete"
							icon="trash"
							small
							danger
							onPress={() => deck.current?.decide("delete")}
							colors={colors}
						/>
						<RoundButton
							label="Keep"
							icon="checkmark"
							onPress={() => deck.current?.decide("keep")}
							colors={colors}
						/>
					</View>
				</>
			) : error ? (
				<View style={styles.center}>
					<Text style={[styles.message, { color: colors.mutedFg }]}>{error}</Text>
					<Pressable
						accessibilityRole="button"
						onPress={() => void load()}
						style={({ pressed }) => [
							styles.chip,
							{ borderColor: colors.border },
							pressed && styles.pressed,
						]}
					>
						<Text style={[styles.chipText, { color: colors.fg }]}>Try Again</Text>
					</Pressable>
				</View>
			) : !page || exhausted ? (
				<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
			) : (
				<View style={styles.center}>
					<SymbolView
						name="checkmark.circle"
						tintColor={colors.mutedFg}
						size={40}
						accessibilityElementsHidden
					/>
					<Text style={[styles.emptyTitle, { color: colors.fg }]}>Nothing left to go through</Text>
					<Text style={[styles.message, { color: colors.mutedFg }]}>
						You've decided on every save from long ago.
					</Text>
					<Pressable
						accessibilityRole="button"
						onPress={() => router.back()}
						style={({ pressed }) => [
							styles.chip,
							{ borderColor: colors.border },
							pressed && styles.pressed,
						]}
					>
						<Text style={[styles.chipText, { color: colors.fg }]}>Done</Text>
					</Pressable>
				</View>
			)}
		</View>
	)
}

/** A round button with its name under it; Delete's is smaller, and red. */
function RoundButton({
	label,
	icon,
	small,
	danger,
	onPress,
	colors,
}: {
	label: string
	icon: "archivebox" | "trash" | "checkmark"
	small?: boolean
	danger?: boolean
	onPress: () => void
	colors: Colors
}) {
	const size = small ? 52 : 68
	const tint = danger ? colors.danger : colors.fg
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			style={({ pressed }) => [styles.button, pressed && styles.pressed]}
		>
			<View
				style={[
					styles.round,
					{
						width: size,
						height: size,
						borderRadius: size / 2,
						backgroundColor: colors.card,
						borderColor: colors.border,
					},
				]}
			>
				<SymbolView
					name={icon}
					tintColor={tint}
					size={small ? 20 : 26}
					accessibilityElementsHidden
				/>
			</View>
			<Text style={[styles.buttonText, { color: danger ? colors.danger : colors.mutedFg }]}>
				{label}
			</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	page: { flex: 1 },
	intro: { fontSize: 14, lineHeight: 19, paddingHorizontal: 20, paddingTop: 12 },
	left: { fontSize: 13, fontWeight: "600", paddingHorizontal: 20, paddingTop: 12 },
	deck: { flex: 1, marginHorizontal: 16, marginTop: 10, marginBottom: 24 },
	buttons: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 36 },
	button: { alignItems: "center", gap: 6 },
	round: {
		alignItems: "center",
		justifyContent: "center",
		borderWidth: StyleSheet.hairlineWidth,
		shadowColor: "#000",
		shadowOpacity: 0.08,
		shadowRadius: 8,
		shadowOffset: { width: 0, height: 2 },
	},
	buttonText: { fontSize: 13, fontWeight: "500" },
	pressed: { opacity: 0.6 },
	loading: { marginTop: 64 },
	center: { alignItems: "center", gap: 12, paddingHorizontal: 32, marginTop: 64 },
	emptyTitle: { fontSize: 20, fontWeight: "600", textAlign: "center" },
	message: { fontSize: 16, lineHeight: 22, textAlign: "center" },
	chip: {
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: 16,
		paddingVertical: 8,
		marginTop: 4,
	},
	chipText: { fontSize: 15, fontWeight: "500" },
})
