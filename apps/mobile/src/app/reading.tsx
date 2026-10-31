import type { ReadingStats } from "@klipstack/sdk"
import { router, useFocusEffect } from "expo-router"
import { useCallback, useRef, useState } from "react"
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	type ScrollViewInstance,
	StyleSheet,
	Text,
	View,
	type ViewStyle,
} from "react-native"
import { InkMark } from "@/components/ink-mark"
import { Paper } from "@/components/paper"
import { useAuth } from "@/lib/auth"
import { dateLocale, errorMessage, t } from "@/lib/i18n"
import { amounts, dayName, heatLevel, periodLabel, total, yearWeeks } from "@/lib/reading"
import { type Colors, fonts, useColors } from "@/lib/theme"

type By = "week" | "month"

/**
 * Your Reading, as the web's /reading page: what was finished in the past 7 days, this month and
 * this year; a year of days, a square each, deeper the more was finished; and the last 12 weeks
 * or months as bars, the one chosen listing what was finished in it and its topics. Counted as
 * Home's line counts, in the phone's time zone. No runs, goals or comparisons: a day without
 * reading is only an empty square. From the Library's places and Home's line.
 */
export default function Reading() {
	const { state } = useAuth()
	const client = state.status === "signed-in" ? state.client : null
	const colors = useColors()
	const [by, setBy] = useState<By>("week")
	const [start, setStart] = useState<string | null>(null)
	// The answer on screen, with the way it was asked for: until the next one comes, its bars keep
	// their own labels, not those of a switch to Weeks or Months just tapped.
	const [shown, setShown] = useState<{ by: By; stats: ReadingStats } | null>(null)
	const stats = shown?.stats ?? null
	const [error, setError] = useState<string | null>(null)
	const latest = useRef(0)

	// Again on each return: an article finished in the reader counts.
	useFocusEffect(
		useCallback(() => {
			if (!client) return
			const mine = ++latest.current
			client.reading
				.get({
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					by,
					start: start ?? undefined,
				})
				.then((answer) => {
					if (mine !== latest.current) return
					setShown({ by, stats: answer })
					setError(null)
				})
				.catch((e: unknown) => {
					if (mine === latest.current) setError(errorMessage(e))
				})
		}, [client, by, start]),
	)

	const read = stats
		? Object.keys(stats.days).length > 0 || stats.periods.some((p) => p.articles > 0)
		: false
	return (
		<Paper>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				contentContainerStyle={styles.page}
				testID="reading"
			>
				<Text style={[styles.description, { color: colors.mutedFg }]}>
					{t("library.reading.description")}
				</Text>
				{error ? <Text style={[styles.note, { color: colors.danger }]}>{error}</Text> : null}
				{!stats ? (
					error ? null : (
						<ActivityIndicator style={styles.loading} />
					)
				) : (
					<>
						{read ? null : (
							<Text testID="reading-empty" style={[styles.empty, { color: colors.mutedFg }]}>
								{t("library.reading.empty")}
							</Text>
						)}
						<Totals stats={stats} colors={colors} />
						<YearGrid stats={stats} colors={colors} />
						<Periods
							stats={stats}
							shown={shown!.by}
							asked={by}
							picked={start}
							onBy={(next) => {
								setBy(next)
								setStart(null)
							}}
							onPick={setStart}
							colors={colors}
						/>
					</>
				)}
			</ScrollView>
		</Paper>
	)
}

/** The three totals in one group, as the Library's places: the period, then what was read in it. */
function Totals({ stats, colors }: { stats: ReadingStats; colors: Colors }) {
	const rows = [
		{ key: "week", label: t("library.reading.pastWeek"), totals: stats.totals.week },
		{ key: "month", label: dayName(stats.today, "month"), totals: stats.totals.month },
		{ key: "year", label: stats.today.slice(0, 4), totals: stats.totals.year },
	] as const
	return (
		<View style={[styles.group, { backgroundColor: colors.muted, borderColor: colors.border }]}>
			{rows.map(({ key, label, totals }, i) => {
				const said = total(totals)
				return (
					<View
						key={key}
						testID={`total-${key}`}
						accessible
						accessibilityLabel={[label, said.articles, said.length, said.book]
							.filter(Boolean)
							.join(", ")}
						style={[
							styles.total,
							i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
						]}
					>
						<View style={styles.totalTop}>
							<Text style={[styles.totalLabel, { color: colors.mutedFg }]}>
								{label.charAt(0).toLocaleUpperCase(dateLocale) + label.slice(1)}
							</Text>
							<Text style={[styles.totalArticles, { color: colors.fg }]}>{said.articles}</Text>
						</View>
						{said.length ? (
							<Text style={[styles.totalLength, { color: colors.mutedFg }]}>{said.length}</Text>
						) : null}
						{said.book ? (
							<Text style={[styles.totalBook, { color: colors.fg }]}>{said.book}</Text>
						) : null}
					</View>
				)
			})}
		</View>
	)
}

const CELL = 13
const GAP = 3
const STEP = CELL + GAP

/**
 * A year of days, a column per week from Monday, as GitHub draws contributions: the web's squares,
 * scrolled sideways, opening on this week. A tap on a square says its day under the grid, where
 * the legend is until then. VoiceOver reads the year's summary instead of 365 squares.
 */
function YearGrid({ stats, colors }: { stats: ReadingStats; colors: Colors }) {
	const [tapped, setTapped] = useState<string | null>(null)
	const grid = useRef<ScrollViewInstance>(null)
	const weeks = yearWeeks(stats.from, stats.today)
	const counts = Object.values(stats.days)
	const finished = counts.reduce((a, b) => a + b, 0)
	const ink = [colors.muted, ...colors.heat]
	const count = tapped ? (stats.days[tapped] ?? 0) : 0
	return (
		<View style={styles.section}>
			<Text accessibilityRole="header" style={[styles.heading, { color: colors.fg }]}>
				{t("library.reading.year.title")}
			</Text>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				// This week first: the far end, as the web's grid opens on a narrow screen.
				ref={grid}
				onContentSizeChange={() => grid.current?.scrollToEnd({ animated: false })}
				style={styles.gridScroll}
				accessible
				accessibilityLabel={t("library.reading.year.summary", {
					count: finished,
					n: new Intl.NumberFormat(dateLocale).format(finished),
					days: t("library.reading.year.days", {
						count: counts.length,
						n: new Intl.NumberFormat(dateLocale).format(counts.length),
					}),
					from: dayName(stats.from, "long"),
				})}
			>
				<View>
					<View style={styles.monthRow}>
						{weeks.map((week, i) => {
							const first = week.find((d) => d.endsWith("-01"))
							return (
								<View key={week[0]} style={styles.monthCell}>
									{first ? (
										<Text
											numberOfLines={1}
											style={[
												styles.monthLabel,
												// In this week's column, it would run past the grid's end, out of sight.
												i === weeks.length - 1 && styles.monthLabelLast,
												{ color: colors.mutedFg },
											]}
										>
											{dayName(first, "monthShort")}
										</Text>
									) : null}
								</View>
							)
						})}
					</View>
					{/* One press for the whole grid, the square found from where it landed. */}
					<Pressable
						testID="year-grid"
						onPress={(e) => {
							const week = weeks[Math.floor(e.nativeEvent.locationX / STEP)]
							const day = week?.[Math.floor(e.nativeEvent.locationY / STEP)]
							if (day) setTapped(day)
						}}
						style={styles.weeks}
					>
						{weeks.map((week) => (
							// Touches pass to the grid, so where they land is measured in it, not in a square.
							<View key={week[0]} style={styles.week} pointerEvents="none">
								{week.map((day) => {
									const level = heatLevel(stats.days[day] ?? 0)
									const square: ViewStyle = { backgroundColor: ink[level] }
									return (
										<View
											key={day}
											style={[
												styles.square,
												square,
												day === tapped && { borderWidth: 1.5, borderColor: colors.fg },
											]}
										/>
									)
								})}
							</View>
						))}
					</Pressable>
				</View>
			</ScrollView>
			<Text testID="year-day" style={[styles.note, { color: colors.mutedFg }]}>
				{tapped
					? count
						? t("library.reading.year.day", { count, date: dayName(tapped, "long") })
						: t("library.reading.year.dayNone", { date: dayName(tapped, "long") })
					: t("library.reading.year.legend")}
			</Text>
			<View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no">
				<Text style={[styles.legendText, { color: colors.mutedFg }]}>
					{t("library.reading.year.less")}
				</Text>
				{ink.map((color) => (
					<View key={color} style={[styles.legendSquare, { backgroundColor: color }]} />
				))}
				<Text style={[styles.legendText, { color: colors.mutedFg }]}>
					{t("library.reading.year.more")}
				</Text>
			</View>
		</View>
	)
}

/** A bar's labels on one line, smaller where a month's short name is wider than it ("sept."). */
const ONE_LINE = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.7 } as const

/** The last 12 weeks or months as bars by words read; the one chosen lists what was finished. */
function Periods({
	stats,
	shown: by,
	asked,
	picked,
	onBy,
	onPick,
	colors,
}: {
	stats: ReadingStats
	/** How `stats` were asked for: its bars and list are named so. */
	shown: By
	/** Weeks or Months as chosen, marked at once; `picked`, the bar tapped, also at once. */
	asked: By
	picked: string | null
	onBy: (by: By) => void
	onPick: (start: string) => void
	colors: Colors
}) {
	const { selected } = stats
	const starts = stats.periods.map((p) => p.start)
	const most = Math.max(1, ...stats.periods.map((p) => p.words))
	const mark = asked === by && picked && starts.includes(picked) ? picked : selected.start
	return (
		<View style={styles.section}>
			<View style={styles.periodsTop}>
				<Text accessibilityRole="header" style={[styles.heading, { color: colors.fg }]}>
					{by === "week"
						? t("library.reading.periods.title")
						: t("library.reading.periods.titleMonth")}
				</Text>
				<View style={styles.switch}>
					{(["week", "month"] as const).map((choice) => (
						<Pressable
							key={choice}
							accessibilityRole="button"
							accessibilityState={{ selected: asked === choice }}
							onPress={() => {
								if (asked !== choice) onBy(choice)
							}}
							hitSlop={6}
						>
							{({ pressed }) => (
								<InkMark
									on={asked === choice}
									pressed={pressed}
									colors={colors}
									style={styles.chip}
								>
									<Text
										style={[
											styles.chipText,
											{ color: asked === choice ? colors.fg : colors.mutedFg },
										]}
									>
										{t(`library.reading.periods.${choice}`)}
									</Text>
								</InkMark>
							)}
						</Pressable>
					))}
				</View>
			</View>
			<View style={styles.bars} testID="period-bars">
				{stats.periods.map((p, i) => {
					const chosen = p.start === mark
					const label = periodLabel(starts, i, by)
					return (
						<Pressable
							key={p.start}
							accessibilityRole="button"
							accessibilityState={{ selected: chosen }}
							accessibilityLabel={t("library.reading.periods.bar", {
								period: label.name,
								articles: amounts.articles(p.articles),
								words: amounts.words(p.words),
							})}
							onPress={() => {
								// Not while the other way's answer is on its way: these bars are not its periods.
								if (!chosen && asked === by) onPick(p.start)
							}}
							style={styles.bar}
						>
							{({ pressed }) => (
								<>
									<View style={styles.barSpace}>
										<View
											style={[
												styles.barFill,
												{
													height: p.words ? `${(p.words / most) * 100}%` : StyleSheet.hairlineWidth,
													minHeight: p.words ? 3 : undefined,
													// The chosen one in the highlighter's ink, as Home marks its choice.
													backgroundColor: chosen
														? colors.nib.yellow
														: `${colors.mutedFg}${pressed ? "99" : "59"}`,
												},
											]}
										/>
									</View>
									<Text
										{...ONE_LINE}
										style={[
											styles.barLabel,
											{ color: chosen ? colors.fg : colors.mutedFg },
											chosen && styles.barLabelChosen,
										]}
									>
										{label.top}
									</Text>
									<Text {...ONE_LINE} style={[styles.barLabel, { color: colors.mutedFg }]}>
										{label.bottom}
									</Text>
								</>
							)}
						</Pressable>
					)
				})}
			</View>
			<View testID="period-selected" style={styles.selected}>
				<Text accessibilityRole="header" style={[styles.selectedTitle, { color: colors.fg }]}>
					{by === "week"
						? t("library.reading.selected.range", {
								from: dayName(selected.start, "short"),
								to: dayName(selected.end, "short"),
							})
						: dayName(selected.start, "monthYear")}
				</Text>
				{selected.topics.length ? (
					<View style={styles.topics}>
						<Text style={[styles.note, { color: colors.mutedFg }]}>
							{t("library.reading.selected.topics")}
						</Text>
						<View style={styles.topicChips}>
							{selected.topics.map((topic) => (
								<Pressable
									key={topic.id}
									accessibilityRole="link"
									accessibilityLabel={`${topic.name}, ${amounts.articles(topic.articles)}`}
									onPress={() =>
										router.navigate(
											{
												pathname: "/library/topics/[id]",
												params: { id: topic.id, name: topic.name },
											},
											{ withAnchor: true },
										)
									}
									style={({ pressed }) => [
										styles.topic,
										{ borderColor: colors.border },
										pressed && { backgroundColor: colors.muted },
									]}
								>
									<Text
										numberOfLines={1}
										style={[styles.topicName, styles.shrink, { color: colors.fg }]}
									>
										{topic.name}
									</Text>
									<Text style={[styles.topicName, { color: colors.mutedFg }]}>
										{topic.articles}
									</Text>
								</Pressable>
							))}
						</View>
					</View>
				) : null}
				{selected.articles.length ? (
					<View style={styles.articles}>
						{selected.articles.map((article, i) => (
							<Pressable
								key={article.id}
								accessibilityRole="link"
								onPress={() => router.push({ pathname: "/read/[id]", params: { id: article.id } })}
								style={({ pressed }) => [
									styles.article,
									i > 0 && { borderTopWidth: StyleSheet.hairlineWidth },
									{ borderColor: colors.border },
									pressed && { opacity: 0.6 },
								]}
							>
								<View style={styles.articleText}>
									<Text numberOfLines={2} style={[styles.articleTitle, { color: colors.fg }]}>
										{article.title ?? article.siteName ?? t("library.reading.untitled")}
									</Text>
									{article.title && article.siteName ? (
										<Text style={[styles.articleSite, { color: colors.mutedFg }]}>
											{article.siteName}
										</Text>
									) : null}
								</View>
								{article.words ? (
									<Text style={[styles.articleSite, { color: colors.mutedFg }]}>
										{amounts.words(article.words)}
									</Text>
								) : null}
							</Pressable>
						))}
					</View>
				) : (
					<Text style={[styles.note, styles.none, { color: colors.mutedFg }]}>
						{t("library.reading.selected.none")}
					</Text>
				)}
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	page: { padding: 16, paddingBottom: 48 },
	loading: { marginTop: 32 },
	description: { fontSize: 15, lineHeight: 21 },
	empty: { fontFamily: fonts.displayItalic, fontSize: 18, lineHeight: 25, marginTop: 20 },
	note: { fontSize: 13, lineHeight: 18, marginTop: 8 },
	group: {
		marginTop: 20,
		borderRadius: 12,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: 14,
	},
	total: { paddingVertical: 10, gap: 2 },
	totalTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
	totalLabel: { fontSize: 14 },
	totalArticles: { fontFamily: fonts.display, fontSize: 24 },
	totalLength: { fontSize: 13, textAlign: "right", fontVariant: ["tabular-nums"] },
	totalBook: { fontFamily: fonts.displayItalic, fontSize: 14, textAlign: "right" },
	section: { marginTop: 32 },
	heading: { fontFamily: fonts.display, fontSize: 22 },
	gridScroll: { marginTop: 10 },
	monthRow: { flexDirection: "row", height: 14 },
	monthCell: { width: STEP, overflow: "visible" },
	monthLabel: { fontSize: 10, width: 40 },
	monthLabelLast: { position: "absolute", right: GAP, textAlign: "right" },
	weeks: { flexDirection: "row", marginTop: 2 },
	week: { marginRight: GAP, gap: GAP },
	square: { width: CELL, height: CELL, borderRadius: 2.5 },
	legend: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
	legendText: { fontSize: 12 },
	legendSquare: { width: 11, height: 11, borderRadius: 2 },
	periodsTop: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		gap: 8,
	},
	switch: { flexDirection: "row", gap: 4 },
	chip: { paddingHorizontal: 10, paddingVertical: 6 },
	chipText: { fontSize: 15, fontWeight: "500" },
	bars: { flexDirection: "row", height: 160, gap: 6, marginTop: 16 },
	bar: { flex: 1 },
	barSpace: { flex: 1, justifyContent: "flex-end" },
	barFill: { borderTopLeftRadius: 3, borderTopRightRadius: 3 },
	barLabel: { fontSize: 11, textAlign: "center", fontVariant: ["tabular-nums"], minHeight: 14 },
	barLabelChosen: { fontWeight: "600" },
	selected: { marginTop: 24 },
	selectedTitle: { fontFamily: fonts.display, fontSize: 22 },
	topics: { marginTop: 4 },
	topicChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
	topic: {
		flexDirection: "row",
		gap: 6,
		borderWidth: 1,
		borderRadius: 99,
		paddingHorizontal: 12,
		paddingVertical: 5,
		maxWidth: "100%",
	},
	topicName: { fontSize: 14 },
	shrink: { flexShrink: 1 },
	articles: { marginTop: 12 },
	article: { flexDirection: "row", alignItems: "baseline", gap: 12, paddingVertical: 10 },
	articleText: { flex: 1, gap: 2 },
	articleTitle: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 21 },
	articleSite: { fontSize: 13, fontVariant: ["tabular-nums"] },
	none: { marginTop: 12 },
})
