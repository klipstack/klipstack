import { Trans, useTranslation } from "react-i18next"
import { useRouteLoaderData } from "react-router"
import type { loader as layoutLoader } from "~/routes/app-layout"

/** Home's greeting, the reader's name marked in, as the landing page marks its promise. */
export function HomeGreeting() {
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")
	return <Greeting name={layout?.user.name.trim().split(/\s+/)[0]} />
}

export function Greeting({ name }: { name: string | undefined }) {
	const { t } = useTranslation("library")
	if (!name) return t("home.welcome")
	// The name is the mark's child, not a value put into the string: whatever it looks like (tags,
	// `{{…}}`), it stays text.
	return (
		<Trans
			t={t}
			i18nKey="home.welcomeNamed"
			components={{ name: <mark className="marker swipe">{name}</mark> }}
		/>
	)
}
