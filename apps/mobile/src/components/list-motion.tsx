import type { ArticleSummary } from "@klipstack/sdk"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import {
	AccessibilityInfo,
	Animated,
	Easing,
	LayoutAnimation,
	StyleSheet,
	Text,
	View,
} from "react-native"
import Svg, { Path } from "react-native-svg"
import { dateLocale, t } from "@/lib/i18n"
import { type Act, advance, LEAVE_MS, type Motion, motionState, settle } from "@/lib/list-motion"
import type { Colors } from "@/lib/theme"

/** Whether iOS's Reduce Motion is on: then nothing here plays, and articles leave at once. */
export function useReduceMotion(): boolean {
	const [reduce, setReduce] = useState(false)
	useEffect(() => {
		let live = true
		void AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setReduce(on))
		const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce)
		return () => {
			live = false
			sub.remove()
		}
	}, [])
	return reduce
}

/** How long an arrival, a return or a stamp where the article stays plays, in ms. */
const SHOW_MS = 1600

/** How long a stamp where the article stays waits for the context menu to close, in ms. */
const STAMP_DELAY = 400

const STAMP_DATE = new Intl.DateTimeFormat(dateLocale, {
	day: "numeric",
	month: "short",
	year: "numeric",
})

/**
 * A list's articles as they show, with the motion of each: `acted` tells it how an action changed
 * an article (`actionMotion`), before the list lets it go. One that left keeps its place while it
 * plays, then the rest close the gap. With Reduce Motion, the list as it is.
 */
export function useListMotion(items: ArticleSummary[] | null): {
	data: ArticleSummary[] | null
	motions: ReadonlyMap<string, Act>
	acted: (id: string, motion: Motion | null) => void
} {
	const reduce = useReduceMotion()
	// What the latest actions asked, until the list shows their change.
	const [acts, setActs] = useState<ReadonlyMap<string, Act>>(NONE)
	const [state, setState] = useState(() => motionState(items))
	let current = state
	if (items !== state.items) {
		// A new list: worked out while rendering it, so a leaving article never blinks out first.
		current = reduce ? motionState(items) : advance(state, items, acts)
		setState(current)
		if (acts.size) setActs(NONE)
	}

	// Each motion ends on its own: a leaving article goes, and the rest slide up into the gap.
	const timers = useRef(new Map<string, { act: Act; timer: ReturnType<typeof setTimeout> }>())
	useEffect(() => {
		const scheduled = timers.current
		for (const [id, act] of state.playing) {
			const was = scheduled.get(id)
			// The same motion is on its way; another one (archived just after it came) starts over.
			if (was?.act === act) continue
			if (was) clearTimeout(was.timer)
			const leaves = act.motion === "archive" || act.motion === "lift"
			const ms =
				act.motion === "archive"
					? LEAVE_MS.archive
					: act.motion === "lift"
						? LEAVE_MS.lift
						: SHOW_MS
			const timer = setTimeout(() => {
				scheduled.delete(id)
				if (leaves) LayoutAnimation.configureNext(SETTLE)
				setState((now) => settle(now, id))
			}, ms)
			scheduled.set(id, { act, timer })
		}
	}, [state.playing])
	useEffect(() => {
		const scheduled = timers.current
		return () => scheduled.forEach(({ timer }) => clearTimeout(timer))
	}, [])

	const acted = useCallback(
		(id: string, motion: Motion | null) => {
			if (!motion || reduce) return
			const date = STAMP_DATE.format(new Date())
			setActs((was) => new Map(was).set(id, { motion, date }))
		},
		[reduce],
	)
	return { data: current.data, motions: reduce ? NONE : current.playing, acted }
}

const NONE: ReadonlyMap<string, Act> = new Map()

/**
 * The rest sliding into the gap: positions only. A grid's cards that change rows are new views,
 * and fading those in would blink the whole list.
 */
const SETTLE = { duration: 240, update: { type: LayoutAnimation.Types.easeInEaseOut } }

/** The archive stamp's word. */
const ARCHIVED = t("library.archivedStamp")

/** Never quite straight, as a stamp by hand. Degrees. */
const TILTS = [-7, -4, 3, -9, 5]

/**
 * An article of a list, played as `motion` says (`useListMotion`): stamped and filed away, lifted
 * away, stamped where it stays, dropped in and clipped, or faded back in. Without one, as it is.
 */
export function MotionCell({
	id,
	act,
	colors,
	children,
}: {
	id: string
	act: Act | undefined
	colors: Colors
	children: ReactNode
}) {
	// Always the same wrapper: a row must not mount again as its motion starts and ends.
	return (
		<Played id={id} motion={act?.motion ?? null} date={act?.date ?? ""} colors={colors}>
			{children}
		</Played>
	)
}

function Played({
	id,
	motion,
	date,
	colors,
	children,
}: {
	id: string
	motion: Motion | null
	date: string
	colors: Colors
	children: ReactNode
}) {
	const [t] = useState(() => new Animated.Value(0))
	const [stamp] = useState(() => new Animated.Value(0))
	const [clip] = useState(() => new Animated.Value(0))
	useEffect(() => {
		if (!motion) return
		for (const value of [t, stamp, clip]) value.setValue(0)
		const ease = Easing.bezier(0.3, 0.7, 0.2, 1)
		const timing = (value: Animated.Value, duration: number, easing = ease) =>
			Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true })
		const thump = timing(stamp, 220, Easing.bezier(0.5, 0, 0.6, 1.3))
		const run =
			motion === "archive"
				? Animated.parallel([timing(t, LEAVE_MS.archive), thump])
				: motion === "stamp"
					? Animated.sequence([
							// After the context menu has let the row go: it hides it while it closes.
							Animated.delay(STAMP_DELAY),
							Animated.parallel([thump, timing(t, 1100, Easing.in(Easing.ease))]),
						])
					: motion === "lift"
						? timing(t, LEAVE_MS.lift, Easing.out(Easing.ease))
						: motion === "arrive"
							? Animated.parallel([timing(t, 260), timing(clip, 1500)])
							: timing(t, 280)
		run.start()
		return () => run.stop()
	}, [motion, t, stamp, clip])

	const cell =
		motion === "archive"
			? {
					// The stamp comes down, the slip gives under it, then it is filed away below.
					opacity: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] }),
					transform: [
						{ translateY: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 14] }) },
						{
							scale: t.interpolate({
								inputRange: [0, 0.28, 0.36, 0.6, 1],
								outputRange: [1, 0.985, 1, 1, 0.96],
							}),
						},
					],
				}
			: motion === "lift"
				? {
						opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
						transform: [
							{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) },
							{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] }) },
						],
					}
				: motion === "arrive"
					? {
							opacity: t,
							transform: [
								{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
							],
						}
					: motion === "return"
						? {
								opacity: t,
								transform: [
									{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
								],
							}
						: motion === "stamp"
							? // A transform, as the archive's: without one the stamp never shows.
								{ transform: [{ scale: 1 }] }
							: null
	const tilt = TILTS[hashOf(id) % TILTS.length]!
	const leaving = motion === "archive" || motion === "lift"
	return (
		<Animated.View
			style={cell}
			collapsable={false}
			// Leaving, it is no longer there to tap, nor for VoiceOver to read.
			pointerEvents={leaving ? "none" : "auto"}
			accessibilityElementsHidden={leaving}
			importantForAccessibility={leaving ? "no-hide-descendants" : "auto"}
		>
			{children}
			{motion === "archive" || motion === "stamp" ? (
				<View pointerEvents="none" style={styles.center}>
					<Animated.View
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
						style={[
							styles.stamp,
							{
								borderColor: colors.stamp,
								opacity:
									motion === "stamp"
										? // In with the thump (220 of 900 ms), then off the card.
											t.interpolate({
												inputRange: [0, 0.17, 0.7, 1],
												outputRange: [0, 0.9, 0.9, 0],
											})
										: stamp.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0.9, 0.9] }),
								transform: [
									{ rotate: `${tilt}deg` },
									{
										scale: stamp.interpolate({
											inputRange: [0, 0.7, 1],
											outputRange: [2.4, 0.95, 1],
										}),
									},
								],
							},
						]}
					>
						<Text allowFontScaling={false} style={[styles.stampWord, { color: colors.stamp }]}>
							{ARCHIVED}
						</Text>
						<Text allowFontScaling={false} style={[styles.stampDate, { color: colors.stamp }]}>
							{date}
						</Text>
					</Animated.View>
				</View>
			) : null}
			{motion === "arrive" ? (
				<Animated.View
					pointerEvents="none"
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					style={[
						styles.clip,
						{
							opacity: clip.interpolate({
								inputRange: [0, 0.14, 0.8, 1],
								outputRange: [0, 1, 1, 0],
							}),
							transform: [
								{
									translateY: clip.interpolate({
										inputRange: [0, 0.14, 0.22, 1],
										outputRange: [-14, 2, 0, 0],
									}),
								},
								{
									rotate: clip.interpolate({
										inputRange: [0, 0.14, 0.22, 1],
										outputRange: ["-16deg", "-6deg", "-8deg", "-8deg"],
									}),
								},
							],
						},
					]}
				>
					<PaperClip color={colors.accent} />
				</Animated.View>
			) : null}
		</Animated.View>
	)
}

function hashOf(text: string): number {
	let n = 0
	for (const c of text) n = (n * 31 + c.charCodeAt(0)) >>> 0
	return n
}

/** The logo's paper clip (brand/klipstack-mark-small.svg). */
function PaperClip({ color }: { color: string }) {
	return (
		<Svg viewBox="0 0 24 24" width={36} height={36} fill="none">
			<Path
				d="M5.42 5.78L2.1 7.1L6.31 15.5"
				stroke={color}
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<Path
				d="M7.14 15.5C6.89 10.63 6.05 6.82 4.9 3C8.6 1.9 13.6 1.3 17.8 1.7Q18.5 1.8 18.7 2.4C20.9 8.6 21.95 14.7 21.85 21Q21.8 21.8 21.1 21.95C18.2 22.6 15.1 22.7 12.5 22.45Q11.8 22.35 11.7 21.6L10.55 11.4C10.2 7.4 16.9 7 17.2 11L17.95 17.4C18.25 19.75 14.7 19.85 14.45 17.5L13.95 12.4"
				stroke={color}
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<Path fill={color} d="M4.96 15.05L8.3 21.7L8.08 14.53L7.08 14.6L5.86 14.6Z" />
		</Svg>
	)
}

const styles = StyleSheet.create({
	center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", zIndex: 1 },
	stamp: {
		alignItems: "center",
		borderWidth: 2,
		borderRadius: 4,
		paddingHorizontal: 10,
		paddingTop: 3,
		paddingBottom: 2,
	},
	stampWord: { fontSize: 15, lineHeight: 17, fontWeight: "700", letterSpacing: 2.1 },
	stampDate: {
		fontSize: 11,
		lineHeight: 13,
		fontWeight: "600",
		letterSpacing: 1.1,
		fontVariant: ["tabular-nums"],
		textTransform: "uppercase",
	},
	clip: { position: "absolute", top: -6, left: 4 },
})
