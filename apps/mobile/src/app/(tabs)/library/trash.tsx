import { LibraryList } from "@/components/library-list"

/** Deleted articles, until the server removes them for good; they can only be restored. */
export default function Trash() {
	return <LibraryList view="trash" empty="The trash is empty." />
}
