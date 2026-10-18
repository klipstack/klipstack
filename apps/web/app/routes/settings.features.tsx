import { useEffect, useEffectEvent, useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { endFeaturesInvitation } from "~/commands/account.server"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { Button } from "~/components/ui/button"
import { ai as aiModule, topicModels } from "~/lib/ai.server"
import { AppError } from "~/lib/app-error"
import { hasFeature } from "~/lib/features.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { resolvePrefs } from "~/lib/prefs"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
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
		// Opened: the sidebar's invitation to this page has done its work.
		invited: !prefs.featuresInvitationEndedAt,
	}
}

/** POST /settings/features  intent=end-invitation: the sidebar's invitation here is over, for good. */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	return answer(async () => {
		if (form.get("intent") !== "end-invitation")
			throw new AppError("invalid_request", "Unknown intent.")
		await endFeaturesInvitation(user.id)
		return {}
	})
}

export default function FeaturesSettings({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	// Seeing this page ends the sidebar's invitation to it: on opening, not in the loader, which a
	// prefetch runs too.
	const ended = useFetcher()
	const endInvitation = useEffectEvent(() =>
		ended.submit({ intent: "end-invitation" }, { method: "post" }),
	)
	useEffect(() => {
		if (loaderData.invited) endInvitation()
	}, [loaderData.invited])
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
