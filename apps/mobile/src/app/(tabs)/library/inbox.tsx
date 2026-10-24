import { useLocalSearchParams, useNavigation } from "expo-router"
import type { NavigationProp } from "expo-router/react-navigation"
import { useEffect } from "react"
import { LibraryList } from "@/components/library-list"
import { t } from "@/lib/i18n"

/** What is saved and not archived: the API's `inbox`, the web's Library. */
export default function Inbox() {
	// Opened with the tab, without animation (`_layout.tsx`); going back animates as usual. This
	// screen's own params: the tab may be in the background, behind Home.
	const { opening } = useLocalSearchParams<{ opening?: string }>()
	const navigation = useNavigation<NavigationProp<{ inbox: { opening?: string } }>>()
	useEffect(() => {
		if (opening) navigation.setParams({ opening: undefined })
	}, [navigation, opening])
	return <LibraryList view="inbox" canSave empty={t("library.empty.inbox")} />
}
