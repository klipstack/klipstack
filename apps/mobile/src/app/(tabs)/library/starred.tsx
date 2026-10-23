import { LibraryList } from "@/components/library-list"
import { t } from "@/lib/i18n"

export default function Starred() {
	return <LibraryList view="starred" empty={t("library.empty.starred")} />
}
