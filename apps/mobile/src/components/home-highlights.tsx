import type { DailyHighlight, KlipstackClient } from "@klipstack/sdk"
import { useMemo } from "react"
import { StyleSheet, View } from "react-native"
import { noteLinking } from "@/components/note-field"
import { QuoteCard, type QuoteContext } from "@/components/notebook-cards"
import { useShareSheet } from "@/components/share-sheet"
import { showToast } from "@/lib/article-changes"
import { offerHighlightUndo } from "@/lib/highlight-undo"
import type { Colors } from "@/lib/theme"

/**
 * Home's "From your highlights", as on the web: a few of the reader's highlights a day
 * (`dailyHighlights`), each as the Notebook's card: the quote in its marker ink, its note on a
 * post-it written on in place, and its article. "Not useful anymore" stops one coming back, with
 * undo; Delete deletes the highlight itself, with undo, as in the Notebook. Nothing to show,
 * nothing here.
 */
export function HomeHighlights({
	items,
	linkTargets,
	client,
	onHide,
	onShow,
	onNote,
	colors,
	headers,
}: {
	items: DailyHighlight[]
	linkTargets: Record<string, "ok" | "trash">
	client: KlipstackClient
	/** Taken off Home at once; `onShow` puts it back. */
	onHide: (id: string) => void
	onShow: (id: string) => void
	onNote: (id: string, note: string | null) => void
	colors: Colors
	headers: Record<string, string> | null
}) {
	const { open: share, sheet: shareSheet } = useShareSheet(client)
	const ctx = useMemo<QuoteContext>(
		() => ({
			client,
			colors,
			headers,
			linking: noteLinking(client, linkTargets),
			onHighlightNote: onNote,
			// Off Home at once; back when the server refused, or after Undo.
			onDelete: (highlight) => {
				onHide(highlight.id)
				const deleting = client.highlights.delete(highlight.id)
				deleting.catch(() => {
					onShow(highlight.id)
					showToast({ message: "Couldn't delete it. Try again." })
				})
				offerHighlightUndo(client, highlight, deleting, () => onShow(highlight.id))
			},
			onShare: share,
		}),
		[client, colors, headers, linkTargets, onNote, onHide, onShow, share],
	)
	const dismiss = (id: string) => {
		onHide(id)
		client.dailyHighlights.dismiss(id).then(
			() =>
				showToast({
					message: "It won't come back here. The highlight stays.",
					action: {
						label: "Undo",
						run: () => {
							onShow(id)
							client.dailyHighlights.restore(id).catch(() => {
								onHide(id)
								showToast({ message: "Couldn't save that. Try again." })
							})
						},
					},
				}),
			() => {
				onShow(id)
				showToast({ message: "Couldn't save that. Try again." })
			},
		)
	}
	if (!items.length) return null
	return (
		<View style={styles.cards}>
			{items.map((h) => (
				<QuoteCard
					key={h.id}
					highlight={h}
					article={h.article}
					onDismiss={() => dismiss(h.id)}
					ctx={ctx}
				/>
			))}
			{shareSheet}
		</View>
	)
}

const styles = StyleSheet.create({
	cards: { paddingHorizontal: 16, gap: 20 },
})
