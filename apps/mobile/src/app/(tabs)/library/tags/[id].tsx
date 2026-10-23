import { addOperator } from "@klipstack/api-contract/search-query"
import type { Tag } from "@klipstack/sdk"
import { router, useLocalSearchParams } from "expo-router"
import type { NativeStackHeaderItem } from "expo-router/native-stack"
import { useMemo } from "react"
import { Alert } from "react-native"
import { LibraryList } from "@/components/library-list"
import { deleteTag, renameTag } from "@/components/tag-actions"
import { useAuth } from "@/lib/auth"
import { errorMessage } from "@/lib/i18n"
import { useColors } from "@/lib/theme"

/**
 * A tag's articles: the search the web's tag chips open (`tag:<name>`), newest first. The header's
 * ⋯ renames or deletes the tag, as its row's menu in Tags does, and as a topic's page does.
 */
export default function TagArticles() {
	const { id, name } = useLocalSearchParams<{ id: string; name: string }>()
	const { state } = useAuth()
	const client = state.status === "signed-in" ? state.client : null
	const colors = useColors()
	const menu = useMemo<NativeStackHeaderItem | undefined>(() => {
		if (!client) return undefined
		// The tag as the server has it now: how many articles, and the others' names to merge into.
		const withTags = (then: (tags: Tag[]) => void) =>
			client.tags
				.list()
				.then(({ items }) => then(items))
				.catch((e: unknown) => Alert.alert("Not loaded", errorMessage(e)))
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
							void withTags((tags) => {
								const tag = tags.find((t) => t.id === id)
								if (tag)
									renameTag(client, tag, tags, (renamed, now) =>
										router.setParams({ name: renamed, id: now }),
									)
							}),
					},
					{
						type: "action",
						label: "Delete",
						icon: { type: "sfSymbol", name: "trash" },
						destructive: true,
						onPress: () =>
							void withTags((tags) => {
								const tag = tags.find((t) => t.id === id)
								if (tag) deleteTag(client, tag, () => router.back())
							}),
					},
				],
			},
		}
	}, [client, id, name, colors.accent])
	return (
		<LibraryList
			query={addOperator("", "tag", name)}
			empty="No articles with this tag."
			headerMenu={menu}
		/>
	)
}
