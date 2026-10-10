import { TRASH_RETENTION_DAYS } from "@klipstack/api-contract/names"
import type { ArticleSummary, KlipstackClient } from "@klipstack/sdk"
import { useCallback, useInsertionEffect, useRef } from "react"
import { Alert } from "react-native"
import { actedOn, afterAction, BULK_CHANGES, type BulkAction } from "@/lib/bulk-actions"

/** What the actions change themselves: Tags opens the tag sheet instead (`useTagSheet`). */
export type ArticleAction = Exclude<BulkAction, "tag">

/**
 * Star, archive, finish, mark unread, delete and restore, for a screen's articles: what
 * multi-select's bar and the long-press menu do. `apply` gets the articles as the action leaves
 * them, at once, then as the server has them; `done`, how many the server changed, and how many it
 * couldn't restore (the same page was saved again since: they stay in the trash). Delete asks
 * first: there is no undo, only the Trash. On failure an alert says so, and `reload` puts the
 * screen right.
 */
export function useArticleActions(options: {
	client: KlipstackClient | null
	apply: (changed: Map<string, ArticleSummary>) => void
	done?: (action: BulkAction, count: number, conflicts: number) => void
	reload: () => void
}): (action: ArticleAction, articles: ArticleSummary[]) => void {
	// The returned function stays the same; it calls the latest callbacks.
	const latest = useRef(options)
	useInsertionEffect(() => {
		latest.current = options
	})

	const run = useCallback(async (action: ArticleAction, acted: ArticleSummary[]) => {
		const { client } = latest.current
		if (!client) return
		const ids = acted.map((a) => a.id)
		const now = new Date().toISOString()
		latest.current.apply(new Map(acted.map((a) => [a.id, afterAction(a, action, now)])))
		try {
			if (action === "delete") {
				const { trashed } = await client.articles.trash(ids)
				latest.current.done?.(action, trashed.length, 0)
			} else if (action === "restore") {
				const { restored, alreadySaved } = await client.articles.restore(ids)
				// Refused: back as they were, in the trash.
				const kept = new Set(alreadySaved.map((a) => a.id))
				if (kept.size)
					latest.current.apply(new Map(acted.filter((a) => kept.has(a.id)).map((a) => [a.id, a])))
				latest.current.done?.(action, restored.length, kept.size)
			} else {
				const answer = await client.articles.update(ids, BULK_CHANGES[action])
				latest.current.apply(new Map(answer.items.map((a) => [a.id, a])))
				latest.current.done?.(action, answer.items.length, 0)
			}
		} catch (e) {
			Alert.alert("Not saved", e instanceof Error ? e.message : String(e))
			latest.current.reload()
		}
	}, [])

	return useCallback(
		(action: ArticleAction, articles: ArticleSummary[]) => {
			const acted = actedOn(articles, action)
			if (acted.length === 0) return
			if (action !== "delete") return void run(action, acted)
			const one = acted.length === 1
			Alert.alert(
				one ? "Delete this article?" : `Delete ${acted.length} articles?`,
				`You can restore ${one ? "it" : "them"} from the Trash for ${TRASH_RETENTION_DAYS} days.`,
				[
					{ text: "Cancel", style: "cancel" },
					{ text: "Delete", style: "destructive", onPress: () => void run(action, acted) },
				],
			)
		},
		[run],
	)
}
