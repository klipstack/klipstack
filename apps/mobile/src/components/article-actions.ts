import type { ArticleSummary, KlipstackClient } from "@klipstack/sdk"
import { useCallback, useInsertionEffect, useRef } from "react"
import { Alert } from "react-native"
import { showToast, track } from "@/lib/article-changes"
import { newTitle } from "@/lib/article-title"
import { actedOn, afterAction, BULK_CHANGES, type BulkAction, bulkNotice } from "@/lib/bulk-actions"
import { afterMarking } from "@/lib/draft-undo"
import { waitForExtraction } from "@/lib/extraction"

/**
 * What the actions change themselves: Tags opens the tag sheet instead (`useTagSheet`). Three are
 * the long-press menu's only, as on the web: Try Again for a failed save (`retry`), Delete Forever
 * in the trash (`purge`), and Rename (`rename`), for one article.
 */
export type ArticleAction = Exclude<BulkAction, "tag"> | "retry" | "purge" | "rename"

/** Asks for an article's new title (the web's editable title); `rename` gets it, when it changed. */
export function askTitle(
	article: Pick<ArticleSummary, "title">,
	rename: (title: string) => void,
): void {
	Alert.prompt(
		"Rename Article",
		undefined,
		[
			{ text: "Cancel", style: "cancel" },
			{
				text: "Rename",
				onPress: (typed?: string) => {
					const title = newTitle(typed, article.title)
					if (title) rename(title)
				},
			},
		],
		"plain-text",
		article.title ?? "",
	)
}

/**
 * Star, archive, finish, mark unread, delete and restore, for a screen's articles: what
 * multi-select's bar and the long-press menu do. `apply` gets the articles as the action leaves
 * them, at once, then as the server has them; `done`, how many the server changed, and how many it
 * couldn't restore (the same page was saved again since: they stay in the trash). Delete acts at
 * once, with a toast whose Undo restores them, as on the web; the screen loads again after the
 * undo. Delete Forever asks first, and the screen loads again after it; Try Again shows the save under way, and the screen loads again once it is done. Unmarking that took articles out of the draft edition
 * in progress offers an undo, as on the web: `apply` gets them back marked. On failure an alert
 * says so, and `reload` puts the screen right.
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

	// Shown at once; as before, with an alert, when the server refuses it.
	const rename = useCallback(async (article: ArticleSummary, title: string) => {
		const { client } = latest.current
		if (!client) return
		latest.current.apply(new Map([[article.id, { ...article, title }]]))
		try {
			// Other screens and the widget load again once it lands.
			const answer = await track(client.articles.rename(article.id, title))
			latest.current.apply(new Map([[article.id, answer.article]]))
		} catch (e) {
			latest.current.apply(new Map([[article.id, article]]))
			Alert.alert("Not renamed", e instanceof Error ? e.message : String(e))
		}
	}, [])

	const run = useCallback(
		async (action: Exclude<ArticleAction, "rename">, acted: ArticleSummary[]) => {
			const { client } = latest.current
			if (!client) return
			const ids = acted.map((a) => a.id)
			const now = new Date().toISOString()
			try {
				if (action === "retry") {
					latest.current.apply(
						new Map(acted.map((a) => [a.id, { ...a, status: "queued" as const, failure: null }])),
					)
					for (const id of ids) {
						const { queued } = await client.articles.retry(id)
						if (queued) await waitForExtraction(client, id)
					}
					return latest.current.reload()
				}
				if (action === "purge") {
					await client.articles.purge(ids)
					return latest.current.reload()
				}
				latest.current.apply(new Map(acted.map((a) => [a.id, afterAction(a, action, now)])))
				if (action === "delete") {
					const { trashed } = await client.articles.trash(ids)
					latest.current.done?.(action, trashed.length, 0)
					if (trashed.length) offerRestore(client, trashed, () => latest.current.reload())
				} else if (action === "restore") {
					const { restored, alreadySaved } = await client.articles.restore(ids)
					// Refused: back as they were, in the trash.
					const kept = new Set(alreadySaved.map((a) => a.id))
					if (kept.size)
						latest.current.apply(new Map(acted.filter((a) => kept.has(a.id)).map((a) => [a.id, a])))
					latest.current.done?.(action, restored.length, kept.size)
				} else {
					const changes = BULK_CHANGES[action]
					const answer = await client.articles.update(ids, changes)
					latest.current.apply(new Map(answer.items.map((a) => [a.id, a])))
					latest.current.done?.(action, answer.items.length, 0)
					afterMarking(client, changes, answer, (items) =>
						latest.current.apply(new Map(items.map((a) => [a.id, a]))),
					)
				}
			} catch (e) {
				Alert.alert("Not saved", e instanceof Error ? e.message : String(e))
				latest.current.reload()
			}
		},
		[],
	)

	return useCallback(
		(action: ArticleAction, articles: ArticleSummary[]) => {
			if (action === "rename") {
				const [article] = articles
				return article && askTitle(article, (title) => void rename(article, title))
			}
			if (action === "retry")
				return void run(
					action,
					articles.filter((a) => a.status === "failed"),
				)
			if (action === "purge") {
				const one = articles.length === 1
				return Alert.alert(
					one ? "Delete this article forever?" : `Delete ${articles.length} articles forever?`,
					`${one ? "Its" : "Their"} highlights and notes go too. This can't be undone.`,
					[
						{ text: "Cancel", style: "cancel" },
						{
							text: "Delete Forever",
							style: "destructive",
							onPress: () => void run(action, articles),
						},
					],
				)
			}
			const acted = actedOn(articles, action)
			if (acted.length === 0) return
			void run(action, acted)
		},
		[run, rename],
	)
}

/**
 * Deleted: the toast says how many, and its Undo takes them out of the trash again; `reload` puts
 * the screen right after. One saved again since stays in the trash, and the toast says so.
 */
export function offerRestore(
	client: Pick<KlipstackClient, "articles">,
	ids: string[],
	reload: () => void,
): void {
	showToast({
		message: ids.length === 1 ? "Deleted" : bulkNotice("delete", ids.length),
		action: {
			label: "Undo",
			run: () => {
				// Other screens load again once it lands.
				track(client.articles.restore(ids)).then(
					({ alreadySaved }) => {
						if (alreadySaved.length)
							showToast({ message: "Saved again since, so it stays in the trash." })
						reload()
					},
					() => showToast({ message: "Couldn't undo it: it's been too long, or you're offline." }),
				)
			},
		},
	})
}
