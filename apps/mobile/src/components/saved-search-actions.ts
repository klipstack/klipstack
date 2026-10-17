import { defaultSavedSearchName } from "@klipstack/api-contract/search-query"
import { type KlipstackClient, KlipstackApiError, type SavedSearch } from "@klipstack/sdk"
import { ActionSheetIOS, Alert } from "react-native"
import { showToast } from "@/lib/article-changes"

/**
 * Saving a search, renaming and deleting one: the web's saved-search dialog and menu, as iOS's own
 * prompts. Each calls `done` once the server has the change, for the screen to load them again.
 * The query of a saved search doesn't change: save the new one and delete the old, as on the web.
 */

/** Asks for a name, starting from the query (or its tag), and saves the query under it. */
export function saveSearch(client: KlipstackClient, query: string, done: () => void) {
	Alert.prompt(
		"Save Search",
		`The Library lists it with its results: ${query}`,
		[
			{ text: "Cancel", style: "cancel" },
			{
				text: "Save",
				onPress: (value?: string) => {
					const name = value?.trim()
					if (!name) return
					client.savedSearches
						.create(name, query)
						.then(done)
						.catch((e: unknown) => refused("Not saved", e))
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
			title: `Saved as “${saved.name}”`,
			options: ["Rename…", "Delete", "Cancel"],
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
		"Rename Saved Search",
		undefined,
		[
			{ text: "Cancel", style: "cancel" },
			{
				text: "Rename",
				onPress: (value?: string) => {
					const name = value?.trim()
					if (!name || name === saved.name) return
					client.savedSearches
						.rename(saved.id, name)
						.then(() => done(name))
						.catch((e: unknown) => refused("Not renamed", e))
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
				message: `Deleted “${saved.name}”`,
				action: {
					label: "Undo",
					run: () =>
						void client.savedSearches
							.create(saved.name, saved.query)
							.then(restored)
							.catch((e: unknown) => refused("Not saved", e)),
				},
			})
		})
		.catch((e: unknown) => refused("Not deleted", e))
}

function refused(title: string, e: unknown) {
	const taken = e instanceof KlipstackApiError && e.code === "name_taken"
	Alert.alert(
		title,
		taken ? "A saved search already has that name." : e instanceof Error ? e.message : String(e),
	)
}
