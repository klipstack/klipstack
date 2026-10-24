import type { KlipstackClient, Snippet } from "@klipstack/sdk"
import { router } from "expo-router"
import { useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { MarkerText } from "@/components/marker-text"
import { PostIt, postItText } from "@/components/post-it"
import { t } from "@/lib/i18n"
import { tiltFor } from "@/lib/post-it"
import type { Colors } from "@/lib/theme"

type Answer = Awaited<ReturnType<KlipstackClient["annotations"]["search"]>>
type Group = "highlights" | "notes"

/** Matches a group shows before "Show all". */
const FIRST = 3
/** The most a group shows in full (`ANNOTATION_SEARCH_MAX`). */
const ALL = 100
/** Waits this long after the last keystroke before searching, as the articles do. */
const DEBOUNCE_MS = 300

/**
 * The highlights and article notes with the words of `q`, as the web's search page groups them
 * beside the articles (`GET /search/annotations`): each highlight's quote in its marker ink, with
 * its note on a post-it, and each note on its paper, the words found in bold, the article beneath.
 * A tap opens the article at the highlight, or with its notes. The first few of each group, and
 * "Show all" for the rest. A server without the search shows nothing here.
 */
export function SearchAnnotations({
	client,
	q,
	colors,
}: {
	client: KlipstackClient
	q: string
	colors: Colors
}) {
	const [answer, setAnswer] = useState<{ q: string; found: Answer } | null>(null)
	// The group shown in full, for this query.
	const [all, setAll] = useState<{ q: string; group: Group; found: Answer } | null>(null)

	useEffect(() => {
		if (!q) return
		let live = true
		const timer = setTimeout(() => {
			client.annotations.search(q, { limit: FIRST }).then(
				(found) => {
					if (live) setAnswer({ q, found })
				},
				() => {
					if (live) setAnswer(null)
				},
			)
		}, DEBOUNCE_MS)
		return () => {
			live = false
			clearTimeout(timer)
		}
	}, [client, q])

	const found = answer?.q === q ? answer.found : null
	if (!found) return null
	const full = all?.q === q ? all : null
	const highlights = full?.group === "highlights" ? full.found.highlights : found.highlights
	const notes = full?.group === "notes" ? full.found.notes : found.notes
	const showAll = (group: Group) =>
		void client.annotations
			.search(q, { only: group, limit: ALL })
			.then((more) => setAll({ q, group, found: more }))
			.catch(() => {})
	if (!highlights.total && !notes.total) return null
	return (
		<View style={styles.groups}>
			{highlights.total ? (
				<View>
					<Heading
						label={t("library.search.highlights")}
						shown={highlights.items.length}
						total={highlights.total}
						onShowAll={() => showAll("highlights")}
						colors={colors}
					/>
					<View style={styles.list}>
						{highlights.items.map((h) => (
							<Pressable
								key={h.id}
								accessibilityRole="link"
								onPress={() =>
									router.push({
										pathname: "/read/[id]",
										params: { id: h.article.id, highlight: h.id },
									})
								}
								style={({ pressed }) => [
									styles.card,
									{ backgroundColor: colors.card, borderColor: colors.border },
									pressed && styles.pressed,
								]}
							>
								<MarkerText
									text={<Marked runs={h.quote} colors={colors} />}
									color={h.color}
									seed={h.id}
									numberOfLines={6}
									colors={colors}
									style={[styles.quote, { color: colors.fg }]}
								/>
								{h.note ? (
									<PostIt
										variant="compact"
										fit={plain(h.note)}
										tilt={tiltFor(h.id)}
										color={h.color}
										colors={colors}
										style={styles.paper}
									>
										<Text style={postItText(colors, "compact", h.color)} numberOfLines={6}>
											<Marked runs={h.note} colors={colors} ink={false} />
										</Text>
									</PostIt>
								) : null}
								<From article={h.article} colors={colors} />
							</Pressable>
						))}
					</View>
				</View>
			) : null}
			{notes.total ? (
				<View>
					<Heading
						label={t("library.search.notes")}
						shown={notes.items.length}
						total={notes.total}
						onShowAll={() => showAll("notes")}
						colors={colors}
					/>
					<View style={styles.list}>
						{notes.items.map((n) => (
							<Pressable
								key={n.article.id}
								accessibilityRole="link"
								accessibilityLabel={t("library.search.noteOn", { title: n.article.title })}
								onPress={() =>
									router.push({ pathname: "/read/[id]", params: { id: n.article.id, notes: "1" } })
								}
								style={({ pressed }) => [styles.note, pressed && styles.pressed]}
							>
								<PostIt
									variant="compact"
									fit={plain(n.note)}
									tilt={tiltFor(n.article.id)}
									colors={colors}
								>
									<Text style={postItText(colors, "compact")} numberOfLines={8}>
										<Marked runs={n.note} colors={colors} ink={false} />
									</Text>
								</PostIt>
								<From article={n.article} colors={colors} />
							</Pressable>
						))}
					</View>
				</View>
			) : null}
			<Text style={[styles.heading, styles.articles, { color: colors.mutedFg }]}>
				{t("library.search.articles")}
			</Text>
		</View>
	)
}

/** A group's name, its count, and "Show all" while it shows only its first few. */
function Heading({
	label,
	shown,
	total,
	onShowAll,
	colors,
}: {
	label: string
	shown: number
	total: number
	onShowAll: () => void
	colors: Colors
}) {
	return (
		<View style={[styles.head, { borderBottomColor: colors.border }]}>
			<Text style={[styles.heading, { color: colors.mutedFg }]}>{label}</Text>
			{shown >= total ? null : total > ALL && shown >= ALL ? (
				<Text style={[styles.more, { color: colors.mutedFg }]}>
					{t("library.search.shownOf", { shown, total })}
				</Text>
			) : (
				<Pressable accessibilityRole="button" hitSlop={8} onPress={onShowAll}>
					<Text style={[styles.more, { color: colors.accent }]}>
						{total > ALL
							? t("library.search.showFirst", { max: ALL })
							: t("library.search.showAll", { total })}
					</Text>
				</Pressable>
			)}
		</View>
	)
}

/** The article a match is in: its title and site. */
function From({
	article,
	colors,
}: {
	article: { title: string; site: string | null }
	colors: Colors
}) {
	return (
		<Text style={[styles.from, { color: colors.mutedFg }]} numberOfLines={1}>
			{[article.title, article.site].filter(Boolean).join(" · ")}
		</Text>
	)
}

/** A snippet with the words the search found in bold (in the page's ink, unless `ink` is off). */
function Marked({ runs, colors, ink = true }: { runs: Snippet; colors: Colors; ink?: boolean }) {
	let at = 0
	return runs.map((run) => {
		const key = at
		at += run.text.length
		return run.match ? (
			<Text key={key} style={[styles.match, ink && { color: colors.fg }]}>
				{run.text}
			</Text>
		) : (
			run.text
		)
	})
}

/** A snippet's text, for the size of its paper. */
function plain(runs: Snippet): string {
	return runs.map((run) => run.text).join("")
}

const styles = StyleSheet.create({
	groups: { gap: 24, paddingTop: 8 },
	head: {
		flexDirection: "row",
		alignItems: "baseline",
		justifyContent: "space-between",
		gap: 12,
		paddingBottom: 8,
		marginBottom: 12,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	heading: { fontSize: 15, fontWeight: "600" },
	articles: { marginBottom: -8 },
	more: { fontSize: 15 },
	list: { gap: 14 },
	card: {
		gap: 10,
		borderRadius: 14,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: 14,
		paddingVertical: 12,
	},
	quote: { fontFamily: "Iowan Old Style", fontSize: 17, lineHeight: 25 },
	paper: { alignSelf: "flex-start", marginTop: 8 },
	note: { gap: 10, alignItems: "flex-start", paddingTop: 8 },
	from: { fontSize: 13 },
	match: { fontWeight: "700" },
	pressed: { opacity: 0.6 },
})
