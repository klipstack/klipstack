import { LibraryList } from "@/components/library-list"
import { t } from "@/lib/i18n"

export default function Archive() {
	return <LibraryList view="archive" empty={t("library.empty.archive")} />
}
