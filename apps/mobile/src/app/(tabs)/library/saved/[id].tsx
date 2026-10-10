import { useLocalSearchParams } from "expo-router"
import { LibraryList } from "@/components/library-list"

/** A saved search's results: its query (`GET /search`), as the web's sidebar opens it. */
export default function SavedSearchResults() {
	const { query } = useLocalSearchParams<{ id: string; name: string; query: string }>()
	return <LibraryList query={query} empty="No articles match." />
}
