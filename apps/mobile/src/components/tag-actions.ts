import { errorDetails, type KlipstackClient, type Tag } from "@klipstack/sdk"
import { Alert } from "react-native"
import { errorMessage, t } from "@/lib/i18n"

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
		t("library.tags.renameTitle"),
		undefined,
		[
			{ text: t("common.actions.cancel"), style: "cancel" },
			{
				text: t("common.actions.rename"),
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
							.catch((e: unknown) => Alert.alert(t("common.failed.notRenamed"), errorMessage(e)))
					if (!other) return void rename()
					Alert.alert(
						t("library.tags.mergeTitle", { name: other.name }),
						t("library.tags.mergeMessage", { tag: tag.name, other: other.name }),
						[
							{ text: t("common.actions.cancel"), style: "cancel" },
							{ text: t("library.tags.merge"), onPress: () => void rename() },
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
				if (!used) return Alert.alert(t("common.failed.notDeleted"), errorMessage(e))
				const names = used.map((s) => t("library.tags.quoted", { name: s.name })).join(", ")
				Alert.alert(
					t("library.tags.usedTitle", { count: used.length }),
					t("library.tags.usedMessage", { names, tag: tag.name }),
					[
						{ text: t("common.actions.cancel"), style: "cancel" },
						{
							text: t("library.tags.deleteAnyway"),
							style: "destructive",
							onPress: () => void remove(true),
						},
					],
				)
			})
	Alert.alert(
		t("library.tags.deleteTitle", { name: tag.name }),
		tag.articles
			? t("library.tags.deleteMessage", { count: tag.articles })
			: t("library.tags.noUndo"),
		[
			{ text: t("common.actions.cancel"), style: "cancel" },
			{ text: t("common.actions.delete"), style: "destructive", onPress: () => void remove(false) },
		],
	)
}
