import { useTranslation } from "react-i18next"
import { useRouteLoaderData } from "react-router"
import type { loader as layoutLoader } from "~/routes/app-layout"

export function HomeGreeting() {
	const { t } = useTranslation("library")
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")
	const name = layout?.user.name.trim().split(/\s+/)[0]
	return name ? t("home.welcomeNamed", { name }) : t("home.welcome")
}
