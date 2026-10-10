import { fallbackLanguage, isLocale } from "@klipstack/i18n"
import { Newspaper, Plus, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect, useFetcher, useNavigation } from "react-router"
import { createEdition, snoozeEditionNudge } from "~/commands/editions.server"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
import { timeZoneFromCookie } from "~/lib/date-groups"
import { plainEditionText } from "~/lib/edition-text"
import { editionState, formatEditionDate, hasUnpublishedChanges } from "~/lib/editions"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { resolvePrefs } from "~/lib/prefs"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import {
	editionNudge,
	listEditions,
	listShortlist,
	type ShortlistEntry,
} from "~/services/editions.server"
import type { Route } from "./+types/editions"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.editions") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.editions" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const [editions, shortlist, nudge] = await Promise.all([
		listEditions(user.id),
		listShortlist(user.id),
		editionNudge(user.id),
	])
	const locale = isLocale(user.locale) ? user.locale : fallbackLanguage
	// Formatted here, as dates are: "3 weeks ago" from the browser could differ from the server's.
	const ago = (days: number) => {
		const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
		return days >= 14 ? format.format(-Math.floor(days / 7), "week") : format.format(-days, "day")
	}
	return {
		shortlist,
		// Why a new edition is due, when it is: the sidebar's dot points here.
		nudge: nudge.reason
			? {
					marked: nudge.marked,
					readSince: nudge.readSince,
					ago: nudge.daysSince === null ? null : ago(nudge.daysSince),
				}
			: null,
		// Public editions link to each other.
		linked: resolvePrefs(user.prefs).linkEditions === "on",
		editions: editions.map((edition) => ({
			id: edition.id,
			title: edition.title,
			// Formatted here: Node and browsers format dates differently, which breaks hydration.
			date: edition.publishedAt
				? formatEditionDate(edition.publishedAt, locale, edition.timeZone)
				: null,
			itemCount: edition.itemCount,
			publicPath: edition.publicPath,
			state: editionState(edition),
			changes: hasUnpublishedChanges(edition),
		})),
	}
}

/**
 * POST /editions: a draft in the reader's time zone and language, with the shortlist's articles.
 * Then the editor. `intent=snooze` is the nudge's "Not now" instead.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	if ((await readForm(request)).get("intent") === "snooze") {
		await snoozeEditionNudge(user.id)
		return { ok: true as const }
	}
	const timeZone = timeZoneFromCookie(request.headers.get("cookie"))
	const locale = isLocale(user.locale) ? user.locale : fallbackLanguage
	const edition = await createEdition(user.id, { locale, timeZone })
	throw redirect(`/editions/${edition.id}`)
}

const STATES = ["draft", "live", "unpublished"] as const

/** The shortlist, the user's editions by state, and a new one. */
export default function Editions({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("editions")
	const { t: tc } = useTranslation()
	const { editions, shortlist, nudge, linked } = loaderData
	const navigation = useNavigation()
	const creating = navigation.state !== "idle" && navigation.formAction === "/editions"
	return (
		<main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-8 md:pt-4 md:pb-8">
			<h1 className="hidden text-2xl font-semibold md:block md:leading-10">{tc("nav.editions")}</h1>
			<p className="text-sm text-muted-fg md:mt-2">{t("description")}</p>
			{nudge ? (
				<Nudge nudge={nudge} creating={creating} />
			) : (
				<Form method="post" action="/editions" className="mt-6">
					<Button type="submit" disabled={creating}>
						<Plus className="size-4" aria-hidden />
						{t("create")}
					</Button>
				</Form>
			)}
			<Shortlist entries={shortlist} />
			{editions.length === 0 ? (
				<p data-testid="editions-empty" className="mt-8 text-sm text-muted-fg">
					{t("empty")}
				</p>
			) : (
				STATES.map((state) => {
					const rows = editions.filter((edition) => edition.state === state)
					if (rows.length === 0) return null
					return (
						<section key={state} className="mt-8" aria-labelledby={`editions-${state}`}>
							<h2 id={`editions-${state}`} className="text-sm font-medium text-muted-fg">
								{t(`state.${state}`)}
							</h2>
							<ul className="mt-2 divide-y divide-border">
								{rows.map((edition) => (
									<li key={edition.id} className="py-3">
										<Link to={`/editions/${edition.id}`} className="font-medium hover:underline">
											{edition.title ?? edition.date ?? t("untitled")}
										</Link>
										<p className="mt-0.5 text-sm text-muted-fg">
											{/* Without a title, the date is the title already. */}
											{edition.title && edition.date ? `${edition.date} · ` : null}
											{t("articles", { count: edition.itemCount })}
											{edition.state !== "draft" && edition.changes ? (
												<>
													{" · "}
													<span className="text-warn">{t("changes")}</span>
												</>
											) : null}
										</p>
										{edition.state === "live" && edition.publicPath ? (
											<a
												href={edition.publicPath}
												className="mt-0.5 block truncate text-sm text-link hover:underline"
											>
												{edition.publicPath}
											</a>
										) : null}
									</li>
								))}
							</ul>
						</section>
					)
				})
			)}
			<LinkEditions linked={linked} />
		</main>
	)
}

/** Whether public editions link to each other: off by default, each was published on its own. */
function LinkEditions({ linked }: { linked: boolean }) {
	const { t } = useTranslation("editions")
	const fetcher = useFetcher()
	const pending = fetcher.formData?.get("linkEditions")
	const on = pending ? pending === "on" : linked
	return (
		<section aria-labelledby="editions-linking" className="mt-10 border-t border-border pt-6">
			<h2 id="editions-linking" className="text-sm font-medium">
				{t("linking.title")}
			</h2>
			<label className="mt-3 flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					checked={on}
					aria-describedby="editions-linking-detail"
					onChange={(e) =>
						void fetcher.submit(
							{ linkEditions: e.target.checked ? "on" : "off" },
							{ method: "post", action: "/prefs" },
						)
					}
					className="mt-0.5"
				/>
				{t("linking.label")}
			</label>
			<p id="editions-linking-detail" className="mt-1 ml-6 text-xs text-muted-fg">
				{t("linking.detail")}
			</p>
		</section>
	)
}

/** The articles marked for the next edition, which a new edition starts with. */
function Shortlist({ entries }: { entries: ShortlistEntry[] }) {
	const { t } = useTranslation("editions")
	return (
		<section
			aria-labelledby="editions-shortlist"
			data-testid="editions-shortlist"
			className="mt-8 rounded-xl border border-border bg-card p-4"
		>
			<h2 id="editions-shortlist" className="flex items-center gap-2 font-medium">
				<Newspaper className="size-4 text-muted-fg" aria-hidden />
				{t("shortlist.heading")}
				{entries.length > 0 ? (
					<span className="text-sm font-normal text-muted-fg">{entries.length}</span>
				) : null}
			</h2>
			<p className="mt-1 text-sm text-muted-fg">
				{entries.length > 0 ? t("shortlist.listDetail") : t("shortlist.empty")}
			</p>
			{entries.length > 0 ? (
				<ul className="mt-3 divide-y divide-border">
					{entries.map((entry) => (
						<ShortlistRow key={entry.id} entry={entry} />
					))}
				</ul>
			) : null}
		</section>
	)
}

function ShortlistRow({ entry }: { entry: ShortlistEntry }) {
	const { t } = useTranslation("editions")
	const { t: tl } = useTranslation("library")
	const fetcher = useFetcher()
	// Gone at once: the list reads again once the server has it.
	if (fetcher.state !== "idle") return null
	const title = entry.title?.trim() || entry.url
	const label = t("shortlist.remove", { title })
	return (
		<li className="flex items-start gap-3 py-2">
			<div className="min-w-0 flex-1">
				<Link
					to={`/read/${entry.id}`}
					className="block truncate text-sm font-medium hover:underline"
				>
					{title}
				</Link>
				{entry.siteName ? <p className="truncate text-xs text-muted-fg">{entry.siteName}</p> : null}
				{/* What the user wrote at its end, for the edition: ready before the edition is. */}
				{entry.editionNote ? (
					<p data-testid="shortlist-note" className="mt-1 line-clamp-2 text-sm text-fg/80">
						{plainEditionText(entry.editionNote)}
					</p>
				) : null}
			</div>
			<fetcher.Form method="post" action={`/documents/${entry.id}/state`}>
				<input type="hidden" name="intent" value="unshortlist" />
				<button
					type="submit"
					aria-label={label}
					{...tooltip(tl("card.unshortlist"))}
					className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
				>
					<X className="size-4" aria-hidden />
				</button>
			</fetcher.Form>
		</li>
	)
}

/**
 * Why a new edition is due, which the sidebar's dot points at, beside the way to make one. "Not
 * now" quiets both for a week.
 */
function Nudge({
	nudge,
	creating,
}: {
	nudge: { marked: number; readSince: number; ago: string | null }
	creating: boolean
}) {
	const { t } = useTranslation("editions")
	const later = useFetcher()
	if (later.state !== "idle") return null
	const reasons = [
		nudge.ago ? t("nudge.last", { ago: nudge.ago }) : null,
		nudge.marked > 0
			? t("nudge.marked", { count: nudge.marked })
			: t("nudge.read", { count: nudge.readSince }),
	].filter(Boolean)
	return (
		<section
			aria-labelledby="editions-nudge"
			data-testid="editions-nudge"
			className="mt-6 rounded-xl border border-accent/40 bg-card p-4"
		>
			<h2 id="editions-nudge" className="font-medium">
				{t("nudge.title")}
			</h2>
			<p className="mt-1 text-sm text-muted-fg">{reasons.join(" ")}</p>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Form method="post" action="/editions">
					<Button type="submit" disabled={creating}>
						<Plus className="size-4" aria-hidden />
						{t("create")}
					</Button>
				</Form>
				<later.Form method="post" action="/editions">
					<input type="hidden" name="intent" value="snooze" />
					<Button type="submit" variant="ghost">
						{t("nudge.later")}
					</Button>
				</later.Form>
			</div>
		</section>
	)
}
