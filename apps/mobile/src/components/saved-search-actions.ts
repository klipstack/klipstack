import { defaultSavedSearchName } from "@klipstack/api-contract/search-query"
import { type KlipstackClient, KlipstackApiError, type SavedSearch } from "@klipstack/sdk"
import { ActionSheetIOS, Alert } from "react-native"

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

export function renameSavedSearch(client: KlipstackClient, saved: SavedSearch, done: () => void) {
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
						.then(done)
						.catch((e: unknown) => refused("Not renamed", e))
				},
			},
		],
		"plain-text",
		saved.name,
	)
}

/** Asks first: there is no undo. The articles stay; only the name for the query goes. */
export function deleteSavedSearch(client: KlipstackClient, saved: SavedSearch, done: () => void) {
	Alert.alert(`Delete “${saved.name}”?`, "Its articles stay. There is no undo.", [
		{ text: "Cancel", style: "cancel" },
		{
			text: "Delete",
			style: "destructive",
			onPress: () =>
				void client.savedSearches
					.delete(saved.id)
					.then(done)
					.catch((e: unknown) => refused("Not deleted", e)),
		},
	])
}

function refused(title: string, e: unknown) {
	const taken = e instanceof KlipstackApiError && e.code === "name_taken"
	Alert.alert(
		title,
		taken ? "A saved search already has that name." : e instanceof Error ? e.message : String(e),
	)
}
