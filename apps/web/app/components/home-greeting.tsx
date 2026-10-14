import { Trans, useTranslation } from "react-i18next"
import { useRouteLoaderData } from "react-router"
import type { PartOfDay } from "~/lib/home-masthead"
import type { loader as layoutLoader } from "~/routes/app-layout"

/**
 * Home's greeting, the reader's name marked in, as the landing page marks its promise. By the part
 * of the day where the reader is; "Welcome back" when Home doesn't know their time zone.
 */
export function HomeGreeting({ part }: { part: PartOfDay | null }) {
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")
	return <Greeting name={layout?.user.name.trim().split(/\s+/)[0]} part={part} />
}

export function Greeting({ name, part }: { name: string | undefined; part: PartOfDay | null }) {
	const { t } = useTranslation("library")
	if (!name) return part ? t(`home.greeting.${part}`) : t("home.welcome")
	// The name is the mark's child, not a value put into the string: whatever it looks like (tags,
	// `{{…}}`), it stays text.
	return (
		<Trans
			t={t}
			i18nKey={part ? `home.greeting.${part}Named` : "home.welcomeNamed"}
			components={{ name: <mark className="marker swipe">{name}</mark> }}
		/>
	)
}
