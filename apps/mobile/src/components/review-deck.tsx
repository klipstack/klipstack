import type { ArticleSummary } from "@klipstack/sdk"
import { router } from "expo-router"
import { type Ref, useImperativeHandle, useInsertionEffect, useLayoutEffect, useState } from "react"
import {
	Animated,
	PanResponder,
	Pressable,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
} from "react-native"
import { CardPicture } from "@/components/article-card"
import { articleMeta } from "@/lib/article-meta"
import { type ReviewAction, savedAgo, swipeDecision } from "@/lib/review"
import type { Colors } from "@/lib/theme"

export type ReviewDeckHandle = {
	/** The buttons' way: the card leaves as a swipe would take it, then `onDecide`. */
	decide: (action: ReviewAction) => void
}

/**
 * The review's article on top, the next one behind it. Swiping the top one right keeps it, left
 * archives it; a tap opens it to read. VoiceOver offers the three actions on the card.
 */
export function ReviewDeck({
	current,
	next,
	onDecide,
	colors,
	headers,
	ref,
}: {
	current: ArticleSummary
	next: ArticleSummary | undefined
	onDecide: (action: ReviewAction, item: ArticleSummary) => void
	colors: Colors
	headers: Record<string, string> | null
	ref?: Ref<ReviewDeckHandle>
}) {
	const { width } = useWindowDimensions()
	// The card's motion, and what the responder made once reads: the latest props, and whether a
	// card is on its way out.
	const [deck] = useState((): Deck => ({
		x: new Animated.Value(0),
		gone: new Animated.Value(0),
		leaving: false,
		current,
		width,
		onDecide,
	}))
	// Each card moves on values of its own: one set back to 0 after a native animation can still
	// show where that animation left it, and the next card would stay off the screen.
	const [motion, setMotion] = useState(() => ({ id: current.id, x: deck.x, gone: deck.gone }))
	if (motion.id !== current.id)
		setMotion({ id: current.id, x: new Animated.Value(0), gone: new Animated.Value(0) })
	const { x, gone } = motion
	useInsertionEffect(() => {
		Object.assign(deck, { current, width, onDecide, x, gone })
	})
	// A new card on top: it can leave in turn.
	useLayoutEffect(() => {
		Object.assign(deck, { leaving: false })
	}, [current.id, deck])
	useImperativeHandle(ref, () => ({ decide: (action) => leave(deck, action) }), [deck])
	const [pan] = useState(() => swipes(deck))

	const third = width / 3
	const rotate = x.interpolate({
		inputRange: [-width, 0, width],
		outputRange: ["-12deg", "0deg", "12deg"],
	})
	// The card behind comes forward as the top one leaves.
	const behind = x.interpolate({
		inputRange: [-third, 0, third],
		outputRange: [1, 0.95, 1],
		extrapolate: "clamp",
	})
	const keepShown = x.interpolate({
		inputRange: [0, third],
		outputRange: [0, 1],
		extrapolate: "clamp",
	})
	const archiveShown = x.interpolate({
		inputRange: [-third, 0],
		outputRange: [1, 0],
		extrapolate: "clamp",
	})

	return (
		<View style={styles.deck}>
			{next ? (
				<Animated.View
					key={next.id}
					pointerEvents="none"
					importantForAccessibility="no-hide-descendants"
					accessibilityElementsHidden
					style={[styles.card, styles.behind, { transform: [{ scale: behind }] }]}
				>
					<Card item={next} colors={colors} headers={headers} />
				</Animated.View>
			) : null}
			<Animated.View
				key={current.id}
				{...pan.panHandlers}
				style={[
					styles.card,
					{
						opacity: gone.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
						transform: [
							{ translateX: x },
							{ translateY: gone.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }) },
							{ rotate },
						],
					},
				]}
			>
				<Pressable
					accessibilityRole="link"
					accessibilityHint="Opens it to read. Swipe right to keep it, left to archive it."
					accessibilityActions={[
						{ name: "keep", label: "Keep" },
						{ name: "archive", label: "Archive" },
						{ name: "delete", label: "Delete" },
					]}
					onAccessibilityAction={(event) =>
						leave(deck, event.nativeEvent.actionName as ReviewAction)
					}
					onPress={() => router.push({ pathname: "/read/[id]", params: { id: current.id } })}
					style={({ pressed }) => [styles.grow, pressed && styles.pressed]}
				>
					<Card item={current} colors={colors} headers={headers} />
				</Pressable>
				<Animated.View
					pointerEvents="none"
					style={[
						styles.stamp,
						styles.keepStamp,
						{ opacity: keepShown, borderColor: colors.accent },
					]}
				>
					<Text style={[styles.stampText, { color: colors.accent }]}>Keep</Text>
				</Animated.View>
				<Animated.View
					pointerEvents="none"
					style={[
						styles.stamp,
						styles.archiveStamp,
						{ opacity: archiveShown, borderColor: colors.mutedFg },
					]}
				>
					<Text style={[styles.stampText, { color: colors.mutedFg }]}>Archive</Text>
				</Animated.View>
			</Animated.View>
		</View>
	)
}

type Deck = {
	x: Animated.Value
	gone: Animated.Value
	leaving: boolean
	current: ArticleSummary
	width: number
	onDecide: (action: ReviewAction, item: ArticleSummary) => void
}

/** The card leaves as the action takes it (deleted, it drops), then the deck's `onDecide`. */
function leave(deck: Deck, action: ReviewAction) {
	if (deck.leaving) return
	deck.leaving = true
	const item = deck.current
	const done = () => deck.onDecide(action, item)
	if (action === "delete")
		Animated.timing(deck.gone, { toValue: 1, duration: 200, useNativeDriver: true }).start(done)
	else
		Animated.timing(deck.x, {
			toValue: (action === "keep" ? 1 : -1) * deck.width * 1.3,
			duration: 200,
			useNativeDriver: true,
		}).start(done)
}

/** Sideways only, so a tap still opens the article: far enough, a decision; otherwise back. */
function swipes(deck: Deck) {
	return PanResponder.create({
		onMoveShouldSetPanResponder: (_, g) =>
			!deck.leaving && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
		onPanResponderTerminationRequest: () => false,
		onPanResponderMove: (_, g) => deck.x.setValue(g.dx),
		onPanResponderRelease: (_, g) => {
			const action = swipeDecision(g.dx, g.vx, deck.width)
			if (action) return leave(deck, action)
			Animated.spring(deck.x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start()
		},
		onPanResponderTerminate: () =>
			Animated.spring(deck.x, { toValue: 0, useNativeDriver: true }).start(),
	})
}

/** The article: its picture when it has one, where it's from, its title and what it's about. */
function Card({
	item,
	colors,
	headers,
}: {
	item: ArticleSummary
	colors: Colors
	headers: Record<string, string> | null
}) {
	return (
		<View style={[styles.face, { backgroundColor: colors.card, borderColor: colors.border }]}>
			{/* A strip of it: the words matter more. */}
			{item.leadImage ? (
				<View style={styles.strip}>
					<CardPicture item={item} colors={colors} headers={headers} radius={0} />
				</View>
			) : null}
			<View style={styles.words}>
				<Text style={[styles.meta, { color: colors.mutedFg }]} numberOfLines={2}>
					{articleMeta(item)}
					{"\n"}
					{savedAgo(item.savedAt)}
				</Text>
				<Text style={[styles.title, { color: colors.fg }]} numberOfLines={4}>
					{item.title ?? item.url}
				</Text>
				{item.description ? (
					<Text style={[styles.description, { color: colors.mutedFg }]} numberOfLines={4}>
						{item.description}
					</Text>
				) : null}
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	deck: { flex: 1 },
	card: { ...StyleSheet.absoluteFill },
	behind: { top: 10 },
	grow: { flex: 1 },
	pressed: { opacity: 0.85 },
	face: {
		flex: 1,
		borderRadius: 20,
		borderWidth: StyleSheet.hairlineWidth,
		overflow: "hidden",
		shadowColor: "#000",
		shadowOpacity: 0.08,
		shadowRadius: 12,
		shadowOffset: { width: 0, height: 4 },
	},
	words: { flex: 1, padding: 20, gap: 8, overflow: "hidden" },
	meta: { fontSize: 14, lineHeight: 19 },
	title: { fontFamily: "Iowan Old Style", fontSize: 26, lineHeight: 31, fontWeight: "600" },
	description: { fontSize: 16, lineHeight: 22 },
	strip: { height: "30%", overflow: "hidden", justifyContent: "center" },
	stamp: {
		position: "absolute",
		top: 24,
		borderWidth: 2,
		borderRadius: 10,
		paddingHorizontal: 12,
		paddingVertical: 4,
	},
	keepStamp: { left: 20, transform: [{ rotate: "-10deg" }] },
	archiveStamp: { right: 20, transform: [{ rotate: "10deg" }] },
	stampText: { fontSize: 22, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
})
