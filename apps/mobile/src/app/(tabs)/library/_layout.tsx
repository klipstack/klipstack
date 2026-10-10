import { Stack } from "expo-router"
import { TabStack } from "@/components/tab-stack"

// The places sit under whichever one opens, so its back button leads to them.
export const unstable_settings = { anchor: "index" }

/**
 * The Library tab: its places (`index`), as Mail's mailboxes, and each place's list: the views,
 * the tags and a tag's articles, a saved search's results. The tab opens on Inbox, with the places
 * behind it (`index.tsx`): that first push has no animation (`opening`).
 */
export default function LibraryLayout() {
	return (
		<TabStack title="Library">
			<Stack.Screen
				name="inbox"
				options={({ route }) => ({
					title: "Inbox",
					animation: (route.params as { opening?: string } | undefined)?.opening
						? "none"
						: "default",
				})}
			/>
			<Stack.Screen name="starred" options={{ title: "Starred" }} />
			<Stack.Screen name="archive" options={{ title: "Archive" }} />
			<Stack.Screen name="trash" options={{ title: "Trash" }} />
			<Stack.Screen name="tags/index" options={{ title: "Tags" }} />
			{/* Named by the tag or the search that opens them (their `name`). */}
			<Stack.Screen name="tags/[id]" options={({ route }) => ({ title: nameOf(route.params) })} />
			<Stack.Screen name="saved/[id]" options={({ route }) => ({ title: nameOf(route.params) })} />
		</TabStack>
	)
}

function nameOf(params: object | undefined): string {
	return (params as { name?: string } | undefined)?.name ?? ""
}
