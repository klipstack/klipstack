import type { ArticleSummary } from "@klipstack/sdk"
import { router, useLocalSearchParams } from "expo-router"
import type { NativeStackHeaderItem } from "expo-router/native-stack"
import { useCallback, useMemo } from "react"
import { LibraryList } from "@/components/library-list"
import { removeTopic, renameTopic } from "@/components/topic-actions"
import { showToast } from "@/lib/article-changes"
import { useAuth } from "@/lib/auth"
import { useColors } from "@/lib/theme"
import { topicRefusal } from "@/lib/topic-shelves"

/**
 * A topic's articles, from its shelf: the library and the archive together, newest saved first,
 * as the web's topic page lists them (`GET /articles?view=all&topic=`), its description above.
 * The header's ⋯ renames or removes the topic; each article's menu takes it out of the topic.
 */
export default function TopicArticles() {
	const { id, name, description } = useLocalSearchParams<{
		id: string
		name: string
		description?: string
	}>()
	const { state } = useAuth()
	const client = state.status === "signed-in" ? state.client : null
	const colors = useColors()
	// Taken out at once, as on the web; the toast says it won't come back.
	const takeOut = useCallback(
		async (item: ArticleSummary) => {
			if (!client) return
			showToast({ message: `Taken out of ${name}. It won't be put back.` })
			await client.topics.takeOut(id, item.id).catch((e: unknown) => {
				showToast({ message: `Not taken out: ${topicRefusal(e)}` })
				throw e
			})
		},
		[client, id, name],
	)
	const menu = useMemo<NativeStackHeaderItem | undefined>(() => {
		if (!client) return undefined
		const topic = { id, name }
		return {
			type: "menu",
			label: "More",
			accessibilityLabel: `More for ${name}`,
			tintColor: colors.accent,
			icon: { type: "sfSymbol", name: "ellipsis.circle" },
			menu: {
				items: [
					{
						type: "action",
						label: "Rename…",
						icon: { type: "sfSymbol", name: "pencil" },
						onPress: () =>
							renameTopic(client, topic, (renamed) => router.setParams({ name: renamed.name })),
					},
					{
						type: "action",
						label: "Remove Topic…",
						icon: { type: "sfSymbol", name: "trash" },
						destructive: true,
						onPress: () => removeTopic(client, topic, () => router.back()),
					},
				],
			},
		}
	}, [client, id, name, colors.accent])
	return (
		<LibraryList
			view="all"
			topic={id}
			intro={description}
			empty="No articles in this topic right now."
			takeOut={takeOut}
			headerMenu={menu}
		/>
	)
}
