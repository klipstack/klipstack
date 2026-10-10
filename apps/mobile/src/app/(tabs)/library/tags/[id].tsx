import { addOperator } from "@klipstack/api-contract/search-query"
import { useLocalSearchParams } from "expo-router"
import { LibraryList } from "@/components/library-list"

/** A tag's articles: the search the web's tag chips open (`tag:<name>`), newest first. */
export default function TagArticles() {
	const { name } = useLocalSearchParams<{ id: string; name: string }>()
	return <LibraryList query={addOperator("", "tag", name)} empty="No articles with this tag." />
}
