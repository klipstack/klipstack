import { errorDetails, type KlipstackClient, type Tag } from "@klipstack/sdk"
import { Alert } from "react-native"

/** Renaming and deleting a tag, as iOS's own prompts: from the Tags list and a tag's own page. */

/**
 * Asks for the new name. One another tag has already merges the two, as on the web: asked first.
 * The saved searches that name the tag follow it (the server rewrites them).
 */
export function renameTag(
	client: KlipstackClient,
	tag: Tag,
	tags: Tag[],
	/** The name, and the tag's id: the other's, when it merged into it. */
	done: (name: string, id: string) => void,
) {
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
							.then(() => done(name, other?.id ?? tag.id))
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
export function deleteTag(client: KlipstackClient, tag: Tag, done: () => void) {
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
