import { TabStack } from "@/components/tab-stack"
import { t } from "@/lib/i18n"

export default function HomeLayout() {
	return <TabStack title={t("common.tabs.home")} canSave />
}
