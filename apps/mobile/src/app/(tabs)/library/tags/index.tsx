import { errorDetails, type KlipstackClient, type Tag } from "@klipstack/sdk"
import { Link, useFocusEffect } from "expo-router"
import { useCallback, useState } from "react"
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text } from "react-native"
import { PlaceGroup, PlaceRow } from "@/components/place-list"
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
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={styles.page}
		>
			{error && !tags ? (
				<Text style={[styles.message, { color: colors.mutedFg }]}>{error}</Text>
			) : !tags ? (
				<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
			) : tags.length === 0 ? (
				<Text style={[styles.message, { color: colors.mutedFg }]}>
					No tags yet. Long-press an article and choose Tags to add one.
				</Text>
			) : (
				<PlaceGroup colors={colors}>
					{tags.map((tag) => (
						<PlaceRow
							key={tag.id}
							title={tag.name}
							icon="tag"
							detail={String(tag.articles)}
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

/**
 * Asks for the new name. One another tag has already merges the two, as on the web: asked first.
 * The saved searches that name the tag follow it (the server rewrites them).
 */
function renameTag(client: KlipstackClient, tag: Tag, tags: Tag[], done: () => void) {
	Alert.prompt(
		"Rename Tag",
		undefined,
		[
			{ text: "Cancel", style: "cancel" },
			{
				text: "Rename",
				onPress: (value?: string) => {
					const name = value?.trim() ?? ""
					if (!name || name === tag.name) return
					const other = tags.find(
						(t) => t.id !== tag.id && t.name.toLowerCase() === name.toLowerCase(),
					)
					const rename = () =>
						client.tags
							.rename(tag.id, name)
							.then(done)
							.catch((e: unknown) =>
								Alert.alert("Not renamed", e instanceof Error ? e.message : String(e)),
							)
					if (!other) return void rename()
					Alert.alert(
						`Merge into “${other.name}”?`,
						`Articles tagged “${tag.name}” get “${other.name}”, and “${tag.name}” goes.`,
						[
							{ text: "Cancel", style: "cancel" },
							{ text: "Merge", onPress: () => void rename() },
						],
					)
				},
			},
		],
		"plain-text",
		tag.name,
	)
}

/**
 * Asks first: there is no undo. A tag that saved searches name is refused (`409
 * tag_in_saved_searches`); the sheet says which, and deletes it anyway on a second yes, leaving
 * those searches to find nothing.
 */
function deleteTag(client: KlipstackClient, tag: Tag, done: () => void) {
	const remove = (force: boolean) =>
		client.tags
			.delete(tag.id, { force })
			.then(done)
			.catch((e: unknown) => {
				const used = errorDetails(e, "tag_in_saved_searches")?.savedSearches
				if (!used) return Alert.alert("Not deleted", e instanceof Error ? e.message : String(e))
				const names = used.map((s) => `“${s.name}”`).join(", ")
				Alert.alert(
					used.length === 1 ? "A saved search uses this tag" : "Saved searches use this tag",
					`${names} will find nothing once “${tag.name}” is gone.`,
					[
						{ text: "Cancel", style: "cancel" },
						{ text: "Delete Anyway", style: "destructive", onPress: () => void remove(true) },
					],
				)
			})
	const count = tag.articles === 1 ? "Its article keeps" : `Its ${tag.articles} articles keep`
	Alert.alert(
		`Delete “${tag.name}”?`,
		tag.articles ? `${count} everything but the tag. There is no undo.` : "There is no undo.",
		[
			{ text: "Cancel", style: "cancel" },
			{ text: "Delete", style: "destructive", onPress: () => void remove(false) },
		],
	)
}

const styles = StyleSheet.create({
	page: { padding: 16 },
	message: { padding: 16, textAlign: "center", fontSize: 16, lineHeight: 22 },
	loading: { paddingVertical: 32 },
})
