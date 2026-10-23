import type { SavedSearch } from "@klipstack/sdk"
import { Link, useFocusEffect, useNavigation } from "expo-router"
import { StackActions } from "expo-router/react-navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { ScrollView, StyleSheet } from "react-native"
import { PlaceGroup, PlaceRow } from "@/components/place-list"
import { deleteSavedSearch, renameSavedSearch } from "@/components/saved-search-actions"
import { useAuth } from "@/lib/auth"
import { t } from "@/lib/i18n"
import { useColors } from "@/lib/theme"

/**
 * The Library tab's first screen: its places, each opening its list, as Mail lists its mailboxes:
 * the views, the tags and topics, the saved searches (as the web's sidebar lists them; a long press renames or
 * deletes one), the review of old saves and the trash. The tab opens on Inbox, with this screen behind it, as Mail opens on its inbox: "‹ Library" leads here,
 * and so does tapping the tab again.
 */
export default function Places() {
	const colors = useColors()
	const { state } = useAuth()
	const client = state.status === "signed-in" ? state.client : null
	const navigation = useNavigation()
	// Once, when the tab's stack starts (native tabs start them all with the app, behind Home): not
	// when something else opened a place already, with this screen under it (`withAnchor`). On this
	// stack only, so the app stays on its tab; a frame later, once the stack takes actions.
	const opened = useRef(false)
	useEffect(() => {
		if (opened.current) return
		const frame = requestAnimationFrame(() => {
			opened.current = true
			if ((navigation.getState()?.routes.length ?? 1) > 1) return
			navigation.dispatch(StackActions.push("inbox", { opening: "1" }))
		})
		return () => cancelAnimationFrame(frame)
	}, [navigation])

	// Saved and changed on the web: loaded with the tab's stack, at launch, so they are there before
	// this screen shows, and again on each return here. Without any (none, or not loaded), their
	// group isn't shown.
	const [saved, setSaved] = useState<SavedSearch[]>([])
	const loadSaved = useCallback(() => {
		client?.savedSearches
			.list()
			.then((answer) => setSaved(answer.items))
			.catch(() => {})
	}, [client])
	useEffect(loadSaved, [loadSaved])
	useFocusEffect(loadSaved)

	// Topics, for an account offered them, in any stage: their screen turns them on and manages them.
	// Without (none offered, or not loaded), no row.
	const [topics, setTopics] = useState(false)
	const loadTopics = useCallback(() => {
		client?.topics
			.list()
			.then((answer) => setTopics(answer.stage !== "unavailable"))
			.catch(() => {})
	}, [client])
	useEffect(loadTopics, [loadTopics])
	useFocusEffect(loadTopics)

	return (
		<ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
			<PlaceGroup colors={colors}>
				<PlaceRow
					title={t("library.places.inbox")}
					icon="tray"
					href="/library/inbox"
					colors={colors}
				/>
				<PlaceRow
					title={t("library.places.starred")}
					icon="star"
					href="/library/starred"
					colors={colors}
				/>
				<PlaceRow
					title={t("library.places.archive")}
					icon="archivebox"
					href="/library/archive"
					colors={colors}
				/>
			</PlaceGroup>
			<PlaceGroup colors={colors}>
				<PlaceRow
					title={t("library.places.tags")}
					icon="tag"
					href="/library/tags"
					colors={colors}
				/>
				{topics ? (
					<PlaceRow
						title={t("library.places.topics")}
						icon="books.vertical"
						href="/library/topics"
						colors={colors}
					/>
				) : null}
			</PlaceGroup>
			<PlaceGroup title={t("library.places.savedSearches")} colors={colors}>
				{saved.map((search) => (
					<PlaceRow
						key={search.id}
						title={search.name}
						icon="magnifyingglass"
						href={{
							pathname: "/library/saved/[id]",
							params: { id: search.id, name: search.name, query: search.query },
						}}
						menu={
							client
								? [
										<Link.MenuAction
											key="rename"
											icon="pencil"
											onPress={() => renameSavedSearch(client, search, loadSaved)}
										>
											{t("common.actions.renameMore")}
										</Link.MenuAction>,
										<Link.MenuAction
											key="delete"
											icon="trash"
											destructive
											onPress={() => deleteSavedSearch(client, search, loadSaved)}
										>
											{t("common.actions.delete")}
										</Link.MenuAction>,
									]
								: undefined
						}
						colors={colors}
					/>
				))}
			</PlaceGroup>
			<PlaceGroup colors={colors}>
				{/* The guide and texts to start with, as the web's sidebar's Discover. */}
				<PlaceRow
					title={t("library.places.discover")}
					icon="safari"
					href="/discover"
					colors={colors}
				/>
				{/* Always here, as in the web's Library menu: Home's card is only an occasional reminder. */}
				<PlaceRow
					title={t("library.places.review")}
					icon="clock.arrow.circlepath"
					href="/review"
					colors={colors}
				/>
				<PlaceRow
					title={t("library.places.trash")}
					icon="trash"
					href="/library/trash"
					colors={colors}
				/>
			</PlaceGroup>
		</ScrollView>
	)
}

const styles = StyleSheet.create({
	page: { padding: 16, gap: 24 },
})
