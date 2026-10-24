import { defaultSavedSearchName } from "@klipstack/api-contract/search-query"
import { type KlipstackClient, KlipstackApiError, type SavedSearch } from "@klipstack/sdk"
import { ActionSheetIOS, Alert } from "react-native"
import { showToast } from "@/lib/article-changes"
import { errorMessage, t } from "@/lib/i18n"

/**
 * Saving a search, renaming and deleting one: the web's saved-search dialog and menu, as iOS's own
 * prompts. Each calls `done` once the server has the change, for the screen to load them again.
 * The query of a saved search doesn't change: save the new one and delete the old, as on the web.
 */

/** Asks for a name, starting from the query (or its tag), and saves the query under it. */
export function saveSearch(client: KlipstackClient, query: string, done: () => void) {
	Alert.prompt(
		t("library.savedSearches.saveTitle"),
		t("library.savedSearches.saveMessage", { query }),
		[
			{ text: t("common.actions.cancel"), style: "cancel" },
			{
				text: t("common.actions.save"),
				onPress: (value?: string) => {
					const name = value?.trim()
					if (!name) return
					client.savedSearches
						.create(name, query)
						.then(done)
						.catch((e: unknown) => refused(t("common.failed.notSaved"), e))
				},
			},
		],
		"plain-text",
		defaultSavedSearchName(query),
	)
}

/** A saved search's actions, as a sheet: from the search screen, for the query it shows. */
export function savedSearchSheet(client: KlipstackClient, saved: SavedSearch, done: () => void) {
	ActionSheetIOS.showActionSheetWithOptions(
		{
			title: t("library.savedSearches.savedAs", { name: saved.name }),
			options: [
				t("common.actions.renameMore"),
				t("common.actions.delete"),
				t("common.actions.cancel"),
			],
			destructiveButtonIndex: 1,
			cancelButtonIndex: 2,
		},
		(index) => {
			if (index === 0) renameSavedSearch(client, saved, done)
			else if (index === 1) deleteSavedSearch(client, saved, done)
		},
	)
}

export function renameSavedSearch(
	client: KlipstackClient,
	saved: Pick<SavedSearch, "id" | "name">,
	done: (name: string) => void,
) {
	Alert.prompt(
		t("library.savedSearches.renameTitle"),
		undefined,
		[
			{ text: t("common.actions.cancel"), style: "cancel" },
			{
				text: t("common.actions.rename"),
				onPress: (value?: string) => {
					const name = value?.trim()
					if (!name || name === saved.name) return
					client.savedSearches
						.rename(saved.id, name)
						.then(() => done(name))
						.catch((e: unknown) => refused(t("common.failed.notRenamed"), e))
				},
			},
		],
		"plain-text",
		saved.name,
	)
}

/**
 * At once, with the toast's Undo, as on the web: the undo saves the query again under its name.
 * The articles stay; only the name for the query goes.
 */
export function deleteSavedSearch(
	client: KlipstackClient,
	saved: Pick<SavedSearch, "id" | "name" | "query">,
	done: () => void,
	/** After Undo saved it again; `done` unless said. */
	restored: () => void = done,
) {
	client.savedSearches
		.delete(saved.id)
		.then(() => {
			done()
			showToast({
				message: t("library.savedSearches.deleted", { name: saved.name }),
				action: {
					label: t("common.actions.undo"),
					run: () =>
						void client.savedSearches
							.create(saved.name, saved.query)
							.then(restored)
							.catch((e: unknown) => refused(t("common.failed.notSaved"), e)),
				},
			})
		})
		.catch((e: unknown) => refused(t("common.failed.notDeleted"), e))
}

function refused(title: string, e: unknown) {
	const taken = e instanceof KlipstackApiError && e.code === "name_taken"
	Alert.alert(title, taken ? t("library.savedSearches.nameTaken") : errorMessage(e))
}
