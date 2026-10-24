import { LibraryList } from "@/components/library-list"
import { t } from "@/lib/i18n"

/** Deleted articles, until the server removes them for good; they can only be restored. */
export default function Trash() {
	return <LibraryList view="trash" empty={t("library.empty.trash")} />
}
