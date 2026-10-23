import { router, useLocalSearchParams } from "expo-router"
import type { NativeStackHeaderItem } from "expo-router/native-stack"
import { useMemo } from "react"
import { LibraryList } from "@/components/library-list"
import { deleteSavedSearch, renameSavedSearch } from "@/components/saved-search-actions"
import { useAuth } from "@/lib/auth"
import { t } from "@/lib/i18n"
import { useColors } from "@/lib/theme"

/**
 * A saved search's results: its query (`GET /search`), as the web's sidebar opens it. The header's
 * ⋯ renames or deletes it, as its row's menu in the Library does.
 */
export default function SavedSearchResults() {
	const { id, name, query } = useLocalSearchParams<{ id: string; name: string; query: string }>()
	const { state } = useAuth()
	const client = state.status === "signed-in" ? state.client : null
	const colors = useColors()
	const menu = useMemo<NativeStackHeaderItem | undefined>(() => {
		if (!client) return undefined
		const saved = { id, name, query }
		return {
			type: "menu",
			label: t("common.actions.more"),
			accessibilityLabel: t("library.moreFor", { name }),
			tintColor: colors.accent,
			icon: { type: "sfSymbol", name: "ellipsis.circle" },
			menu: {
				items: [
					{
						type: "action",
						label: t("common.actions.renameMore"),
						icon: { type: "sfSymbol", name: "pencil" },
						onPress: () =>
							renameSavedSearch(client, saved, (renamed) => router.setParams({ name: renamed })),
					},
					{
						type: "action",
						label: t("common.actions.delete"),
						icon: { type: "sfSymbol", name: "trash" },
						destructive: true,
						// Back to the Library, which lists it again after Undo, when it loads.
						onPress: () =>
							deleteSavedSearch(
								client,
								saved,
								() => router.back(),
								() => undefined,
							),
					},
				],
			},
		}
	}, [client, id, name, query, colors.accent])
	return <LibraryList query={query} empty={t("library.empty.noMatch")} headerMenu={menu} />
}
