import { X } from "lucide-react"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
import { ai as aiModule, topicModels } from "~/lib/ai.server"
import { hasFeature } from "~/lib/features.server"
import { languageName } from "~/lib/languages"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { resolvePrefs } from "~/lib/prefs"
import { requireUser } from "~/lib/session.server"
import { hasTopics } from "~/services/topics.server"
import type { Route } from "./+types/settings.features"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:features.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:features.title" } }

/**
 * The parts of Klipstack the account turns on and off. AI answers and topics only for accounts with
 * their feature, on a server set up for them; topics also for one that has topics still, to turn
 * them off.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const prefs = resolvePrefs(user.prefs)
	const [aiFlag, topicsFlag, topicsOn] = await Promise.all([
		hasFeature(user.id, "ai"),
		hasFeature(user.id, "topics"),
		hasTopics(user.id),
	])
	const topicsUsable = topicsFlag && topicModels.available
	return {
		editions: prefs.editions === "on",
		feeds: prefs.feeds === "on",
		ai: aiFlag && aiModule.available ? prefs.ai !== "off" : null,
		topics: topicsUsable || topicsOn ? { on: topicsOn, usable: topicsUsable } : null,
		neverTranslate: prefs.neverTranslate,
		alwaysTranslate: prefs.alwaysTranslate,
	}
}

export default function FeaturesSettings({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	return (
		<SettingsPage title={t("features.title")} description={t("features.description")}>
			{loaderData.ai !== null ? (
				<PrefSwitch
					name="ai"
					on={loaderData.ai}
					title={t("features.ai.title")}
					label={t("features.ai.label")}
					description={t("features.ai.description")}
				/>
			) : null}
			{loaderData.ai !== null || loaderData.neverTranslate.length > 0 ? (
				<TranslationLanguages choice="never" languages={loaderData.neverTranslate} />
			) : null}
			{loaderData.ai !== null || loaderData.alwaysTranslate.length > 0 ? (
				<TranslationLanguages choice="always" languages={loaderData.alwaysTranslate} />
			) : null}
			<PrefSwitch
				name="editions"
				on={loaderData.editions}
				title={t("features.editions.title")}
				label={t("features.editions.label")}
				description={t("features.editions.description")}
			/>
			<PrefSwitch
				name="feeds"
				on={loaderData.feeds}
				title={t("features.feeds.title")}
				label={t("features.feeds.label")}
				description={t("features.feeds.description")}
			/>
			{loaderData.topics ? <TopicsSwitch {...loaderData.topics} /> : null}
		</SettingsPage>
	)
}

/** A feature kept in the prefs: saved as it is ticked, as the single-key shortcuts are. */
function PrefSwitch({
	name,
	on: saved,
	title,
	label,
	description,
}: {
	name: "ai" | "editions" | "feeds"
	on: boolean
	title: string
	label: string
	description: string
}) {
	const fetcher = useFetcher()
	const helpId = useId()
	const [on, setOn] = useState(saved)
	return (
		<SettingsCard title={title}>
			<label className="mt-3 flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					data-testid={`feature-${name}`}
					aria-describedby={helpId}
					checked={on}
					onChange={(e) => {
						setOn(e.target.checked)
						void fetcher.submit(
							{ [name]: e.target.checked ? "on" : "off" },
							{ method: "post", action: "/prefs" },
						)
					}}
				/>
				{label}
			</label>
			<p id={helpId} className="mt-2 text-sm text-muted-fg">
				{description}
			</p>
		</SettingsCard>
	)
}

/**
 * The languages never translated (the account reads them: not offered a translation), or always
 * (translated as they are saved). Removing one puts it back to being offered.
 */
function TranslationLanguages({
	choice,
	languages,
}: {
	choice: "never" | "always"
	languages: readonly string[]
}) {
	const { t, i18n } = useTranslation("settings")
	const key = choice === "never" ? "translation" : "alwaysTranslation"
	const fetcher = useFetcher()
	// Gone as soon as it is removed, while the server forgets it.
	const removing = fetcher.formData?.get("language")
	const shown = languages.filter((code) => code !== removing)
	return (
		<SettingsCard title={t(`features.${key}.title`)} description={t(`features.${key}.description`)}>
			{shown.length === 0 ? (
				<p className="mt-3 text-sm text-muted-fg">{t(`features.${key}.empty`)}</p>
			) : (
				<ul data-testid={`${choice}-translate`} className="mt-3 flex flex-wrap gap-2">
					{shown.map((code) => {
						const name = languageName(code, i18n.language)
						return (
							<li
								key={code}
								className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-3 text-sm"
							>
								{name}
								<button
									type="button"
									aria-label={t(`features.${key}.remove`, { language: name })}
									{...tooltip(t(`features.${key}.remove`, { language: name }))}
									onClick={() =>
										void fetcher.submit(
											{ language: code, choice: "ask" },
											{ method: "post", action: "/translation/languages" },
										)
									}
									className="rounded-full p-1 text-muted-fg hover:bg-fg/10 hover:text-fg"
								>
									<X className="size-3.5" aria-hidden />
								</button>
							</li>
						)
					})}
				</ul>
			)}
		</SettingsCard>
	)
}

/**
 * Topics, through the Topics page's own actions. Turning them off deletes them, so it asks once
 * more, as the Topics page does.
 */
function TopicsSwitch({ on: saved, usable }: { on: boolean; usable: boolean }) {
	const { t } = useTranslation("settings")
	const fetcher = useFetcher()
	// As asked, while the server turns them on or off.
	const intent = fetcher.formData?.get("intent")
	const on = intent === "enable" ? true : intent === "disable" ? false : saved
	const helpId = useId()
	const [asked, setAsked] = useState(false)
	// Asked again only while they are on: turned off, the question is over.
	const armed = asked && on
	const pending = fetcher.state !== "idle"
	const turn = (intent: "enable" | "disable") =>
		void fetcher.submit({ intent }, { method: "post", action: "/topics" })
	return (
		<SettingsCard title={t("features.topics.title")}>
			<label className="mt-3 flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					data-testid="feature-topics"
					aria-describedby={helpId}
					checked={on || armed}
					// Without the feature, a reader who has topics may only turn them off.
					disabled={pending || (!on && !usable)}
					onChange={(e) => {
						setAsked(!e.target.checked)
						if (e.target.checked) turn("enable")
					}}
				/>
				{t("features.topics.label")}
			</label>
			<p id={helpId} className="mt-2 text-sm text-muted-fg">
				{t("features.topics.description")}
			</p>
			{armed ? (
				<div role="alert" className="mt-3 flex flex-wrap items-center gap-2">
					<p className="w-full text-sm">{t("features.topics.confirm")}</p>
					<Button
						type="button"
						variant="danger"
						size="sm"
						disabled={pending}
						onClick={() => turn("disable")}
					>
						{t("features.topics.turnOff")}
					</Button>
					<Button type="button" variant="secondary" size="sm" onClick={() => setAsked(false)}>
						{t("features.topics.keep")}
					</Button>
				</div>
			) : on ? (
				<Link
					to="/topics"
					className="mt-3 inline-block text-sm font-medium text-link hover:underline"
				>
					{t("features.topics.open")}
				</Link>
			) : null}
		</SettingsCard>
	)
}
