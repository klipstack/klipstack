import type { Tag } from "@klipstack/sdk"
import { Link, useFocusEffect } from "expo-router"
import { useCallback, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { EmptyDrawing } from "@/components/empty-drawing"
import { PlaceGroup, PlaceRow } from "@/components/place-list"
import { deleteTag, renameTag } from "@/components/tag-actions"
import { useAuth } from "@/lib/auth"
import { useColors } from "@/lib/theme"

/**
 * Every tag, by name, with how many articles have it (`GET /tags`), as the web's tags page lists
 * them. A tag opens its articles; a long press renames or deletes it. Loaded again on each return
 * here, and after a change: the web changes tags too, and the tag sheet makes them.
 */
export default function Tags() {
	const colors = useColors()
	const { state } = useAuth()
	const client = state.status === "signed-in" ? state.client : null
	const [tags, setTags] = useState<Tag[] | null>(null)
	const [error, setError] = useState<string | null>(null)
	const load = useCallback(() => {
		client?.tags
			.list()
			.then((answer) => {
				setTags(answer.items)
				setError(null)
			})
			.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
	}, [client])
	useFocusEffect(load)

	return (
		<ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
			{error && !tags ? (
				<Text style={[styles.message, { color: colors.mutedFg }]}>{error}</Text>
			) : !tags ? (
				<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
			) : tags.length === 0 ? (
				<View style={styles.empty}>
					<EmptyDrawing name="tags" />
					<Text style={[styles.message, { color: colors.mutedFg }]}>
						No tags yet. Long-press an article and choose Tags to add one.
					</Text>
				</View>
			) : (
				<PlaceGroup colors={colors}>
					{tags.map((tag) => (
						<PlaceRow
							key={tag.id}
							title={tag.name}
							icon="tag"
							detail={String(tag.articles)}
							detailLabel={tag.articles === 1 ? "1 article" : `${tag.articles} articles`}
							href={{ pathname: "/library/tags/[id]", params: { id: tag.id, name: tag.name } }}
							menu={
								client
									? [
											<Link.MenuAction
												key="rename"
												icon="pencil"
												onPress={() => renameTag(client, tag, tags, load)}
											>
												Rename…
											</Link.MenuAction>,
											<Link.MenuAction
												key="delete"
												icon="trash"
												destructive
												onPress={() => deleteTag(client, tag, load)}
											>
												Delete
											</Link.MenuAction>,
										]
									: undefined
							}
							colors={colors}
						/>
					))}
				</PlaceGroup>
			)}
		</ScrollView>
	)
}

const styles = StyleSheet.create({
	page: { padding: 16 },
	message: { padding: 16, textAlign: "center", fontSize: 16, lineHeight: 22 },
	empty: { marginTop: 48, gap: 4 },
	loading: { paddingVertical: 32 },
})
