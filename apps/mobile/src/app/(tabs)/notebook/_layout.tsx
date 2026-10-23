import { TabStack } from "@/components/tab-stack"
import { t } from "@/lib/i18n"

export default function NotebookLayout() {
	return <TabStack title={t("common.tabs.notebook")} />
}
