import { useLocalSearchParams } from "expo-router"
import { LibraryList } from "@/components/library-list"

/**
 * A topic's articles, from its shelf: the library and the archive together, newest saved first,
 * as the web's topic page lists them (`GET /articles?view=all&topic=`), its description above.
 */
export default function TopicArticles() {
	const { id, description } = useLocalSearchParams<{
		id: string
		name: string
		description?: string
	}>()
	return (
		<LibraryList
			view="all"
			topic={id}
			intro={description}
			empty="No articles in this topic right now."
		/>
	)
}
