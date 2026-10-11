import { db } from "@klipstack/db"
import { fallbackLanguage, isLocale } from "@klipstack/i18n"
import { Check, Copy, Eye, Newspaper, Plus, Settings2, X } from "lucide-react"
import { Fragment } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect, useFetcher, useNavigation } from "react-router"
import { snoozeEditionNudge, startEdition } from "~/commands/editions.server"
import { MenuRadio, MoreMenu } from "~/components/more-menu"
import { tooltip } from "~/components/tooltip-host"
import { Button, buttonVariants } from "~/components/ui/button"
import { copyText } from "~/lib/copy-link"
import { timeZoneFromCookie } from "~/lib/date-groups"
import { plainEditionText } from "~/lib/edition-text"
import {
	dayIn,
	editionState,
	formatEditionDate,
	hasUnpublishedChanges,
	publishProblems,
} from "~/lib/editions"
import { env } from "~/lib/env.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { resolvePrefs } from "~/lib/prefs"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import {
	currentDraft,
	editionNudge,
	getEdition,
	listEditions,
	listShortlist,
	type ShortlistEntry,
} from "~/services/editions.server"
import type { Route } from "./+types/editions"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.editions") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.editions" } }

const DAY_MS = 86_400_000
/** Articles the desk names; the editor has the rest. */
const DESK_ITEMS = 4

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const [editions, draft, nudge] = await Promise.all([
		listEditions(user.id),
		currentDraft(db, user.id),
		editionNudge(user.id),
	])
	const locale = isLocale(user.locale) ? user.locale : fallbackLanguage
	// Formatted here, as dates are: "3 weeks ago" from the browser could differ from the server's.
	const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
	const ago = (days: number) =>
		days >= 14 ? format.format(-Math.floor(days / 7), "week") : format.format(-days, "day")
	return {
		// The draft in progress; without one, the articles a new edition starts with.
		desk: draft ? await draftDesk(user.id, draft.id, ago) : null,
		shortlist: draft ? [] : await listShortlist(user.id),
		// Why an edition is due, when one is: the sidebar's dot points here.
		nudge: nudge.reason
			? {
					reason: nudge.reason,
					marked: nudge.marked,
					readSince: nudge.readSince,
					ago: nudge.daysSince === null ? null : ago(nudge.daysSince),
				}
			: null,
		// Public editions link to each other.
		linked: resolvePrefs(user.prefs).linkEditions === "on",
		otherDrafts: editions
			.filter((edition) => !edition.publishedAt && edition.id !== draft?.id)
			.map((edition) => ({ id: edition.id, title: edition.title, itemCount: edition.itemCount })),
		past: editions.flatMap((edition) =>
			edition.publishedAt
				? [
						{
							id: edition.id,
							title: edition.title,
							// Formatted here: Node and browsers format dates differently, which breaks hydration.
							date: formatEditionDate(edition.publishedAt, locale, edition.timeZone),
							year: dayIn(edition.publishedAt, edition.timeZone).slice(0, 4),
							itemCount: edition.itemCount,
							state: editionState(edition),
							changes: hasUnpublishedChanges(edition),
							publicUrl:
								edition.publicPath && !edition.unpublishedAt
									? `${env.APP_URL}${edition.publicPath}`
									: null,
						},
					]
				: [],
		),
	}
}

/** The draft in progress as the desk shows it: its first articles, its age, and what blocks it. */
async function draftDesk(userId: string, id: string, ago: (days: number) => string) {
	const { edition, items } = await getEdition(userId, id)
	const days = (date: Date) => Math.max(0, Math.floor((Date.now() - date.getTime()) / DAY_MS))
	const started = days(edition.createdAt)
	const edited = days(edition.updatedAt)
	return {
		id: edition.id,
		title: edition.title,
		started: ago(started),
		// Edited the day it was started says nothing more.
		edited: edited === started ? null : ago(edited),
		itemCount: items.length,
		items: items.slice(0, DESK_ITEMS).map((item) => ({
			id: item.id,
			title: item.title,
			siteName: item.siteName,
			note: item.includeNote && item.note ? plainEditionText(item.note) : null,
		})),
		problems: publishProblems(items).length,
	}
}

/**
 * POST /editions: "Start", which opens the draft in progress, or else makes one in the reader's
 * time zone and language with the shortlist's articles. `intent=snooze` is "Not now" instead.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	if ((await readForm(request)).get("intent") === "snooze") {
		await snoozeEditionNudge(user.id)
		return { ok: true as const }
	}
	const timeZone = timeZoneFromCookie(request.headers.get("cookie"))
	const locale = isLocale(user.locale) ? user.locale : fallbackLanguage
	const edition = await startEdition(user.id, { locale, timeZone })
	throw redirect(`/editions/${edition.id}`)
}

type LoaderData = Route.ComponentProps["loaderData"]

/** The next edition first, as a draft or as what it starts with; then the published ones. */
export default function Editions({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("editions")
	const { t: tc } = useTranslation()
	const { desk, shortlist, nudge, linked, otherDrafts, past } = loaderData
	return (
		<main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-8 md:pt-4 md:pb-8">
			<h1 className="hidden text-2xl font-semibold md:block md:leading-10">{tc("nav.editions")}</h1>
			<p className="text-sm text-muted-fg md:mt-2">{t("description")}</p>
			{desk ? (
				<DraftDesk draft={desk} due={nudge?.reason === "draft"} />
			) : (
				<NextDesk entries={shortlist} nudge={nudge} />
			)}
			{otherDrafts.length > 0 ? (
				<section aria-labelledby="editions-drafts" className="mt-6">
					<h2 id="editions-drafts" className="text-sm font-medium text-muted-fg">
						{t("desk.otherDrafts")}
					</h2>
					<ul className="mt-1 divide-y divide-border">
						{otherDrafts.map((draft) => (
							<li key={draft.id} className="flex items-baseline gap-2 py-2 text-sm">
								<Link to={`/editions/${draft.id}`} className="font-medium hover:underline">
									{draft.title ?? t("untitled")}
								</Link>
								<span className="text-muted-fg">{t("articles", { count: draft.itemCount })}</span>
							</li>
						))}
					</ul>
				</section>
			) : null}
			<PastEditions editions={past} linked={linked} />
		</main>
	)
}

/** "Not now" on the nudge: gone at once, as the nudge is once the server has it. */
function useSnooze() {
	const fetcher = useFetcher()
	const snoozed = fetcher.state !== "idle" || fetcher.data !== undefined
	const button = (
		<fetcher.Form method="post" action="/editions">
			<input type="hidden" name="intent" value="snooze" />
			<SnoozeButton />
		</fetcher.Form>
	)
	return { snoozed, button }
}

function SnoozeButton() {
	const { t } = useTranslation("editions")
	return (
		<Button type="submit" variant="ghost">
			{t("nudge.later")}
		</Button>
	)
}

/** The draft in progress: what is in it, how old it is, and the way back to it. */
function DraftDesk({ draft, due }: { draft: NonNullable<LoaderData["desk"]>; due: boolean }) {
	const { t } = useTranslation("editions")
	const snooze = useSnooze()
	const nudging = due && !snooze.snoozed
	const editor = `/editions/${draft.id}`
	return (
		<section
			aria-labelledby="editions-desk"
			data-testid="editions-desk"
			className="mt-6 rounded-xl border border-border bg-card p-4"
		>
			<div className="flex flex-wrap items-center gap-2">
				<h2 id="editions-desk" className="font-medium">
					<Link to={editor} className="hover:underline">
						{draft.title ?? t("desk.heading")}
					</Link>
				</h2>
				<span className="rounded-md border border-border px-1.5 text-xs text-muted-fg">
					{t("state.draft")}
				</span>
			</div>
			<p className="mt-0.5 text-sm text-muted-fg">
				{draft.edited
					? t("desk.startedEdited", { started: draft.started, edited: draft.edited })
					: t("desk.started", { started: draft.started })}
			</p>
			{draft.items.length > 0 ? (
				<ul
					data-testid="editions-desk-items"
					className="mt-3 divide-y divide-border border-t border-border"
				>
					{draft.items.map((item) => (
						<li key={item.id} className="py-2">
							<p className="truncate text-sm font-medium">{item.title}</p>
							{item.siteName || item.note ? (
								<p className="truncate text-xs text-muted-fg">
									{[item.siteName, item.note].filter(Boolean).join(" — ")}
								</p>
							) : null}
						</li>
					))}
				</ul>
			) : null}
			{draft.itemCount > draft.items.length ? (
				<p className="text-sm text-muted-fg">
					{t("desk.more", { count: draft.itemCount - draft.items.length })}
				</p>
			) : null}
			<p className="mt-3 text-sm text-muted-fg">{t("desk.addMore")}</p>
			{draft.itemCount > 0 ? (
				<p data-testid="editions-desk-status" className="mt-3 flex items-center gap-2 text-sm">
					{nudging || draft.problems > 0 ? (
						<span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
					) : (
						<Check className="size-4 shrink-0 text-muted-fg" aria-hidden />
					)}
					{nudging
						? t("desk.due", { ago: draft.started })
						: draft.problems > 0
							? t("desk.problems", { count: draft.problems })
							: t("desk.ready")}
				</p>
			) : null}
			<div className="mt-4 flex flex-wrap items-center gap-2">
				<Link to={editor} className={buttonVariants()}>
					{nudging ? t("desk.review") : t("desk.continue")}
				</Link>
				{draft.itemCount > 0 ? (
					<Link to={`${editor}/preview`} className={buttonVariants({ variant: "secondary" })}>
						<Eye className="size-4" aria-hidden />
						{t("editor.preview")}
					</Link>
				) : null}
				{nudging ? snooze.button : null}
			</div>
		</section>
	)
}

/** No draft yet: the articles marked for the next edition, and the way to start it. */
function NextDesk({ entries, nudge }: { entries: ShortlistEntry[]; nudge: LoaderData["nudge"] }) {
	const { t } = useTranslation("editions")
	const navigation = useNavigation()
	const starting = navigation.state !== "idle" && navigation.formAction === "/editions"
	const snooze = useSnooze()
	const nudging = nudge !== null && !snooze.snoozed
	const reasons = nudge
		? [
				nudge.ago ? t("nudge.last", { ago: nudge.ago }) : null,
				nudge.marked > 0
					? t("nudge.marked", { count: nudge.marked })
					: t("nudge.read", { count: nudge.readSince }),
			].filter(Boolean)
		: []
	return (
		<section
			aria-labelledby="editions-desk"
			data-testid="editions-desk"
			className="mt-6 rounded-xl border border-border bg-card p-4"
		>
			<h2 id="editions-desk" className="flex items-center gap-2 font-medium">
				<Newspaper className="size-4 text-muted-fg" aria-hidden />
				{t("desk.heading")}
				{entries.length > 0 ? (
					<span className="text-sm font-normal text-muted-fg">{entries.length}</span>
				) : null}
			</h2>
			{nudging ? (
				<p data-testid="editions-nudge" className="mt-1 flex items-center gap-2 text-sm">
					<span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
					{reasons.join(" ")}
				</p>
			) : null}
			<p className="mt-1 text-sm text-muted-fg">
				{entries.length > 0 ? t("desk.markedDetail") : t("desk.emptyDetail")}
			</p>
			{entries.length > 0 ? (
				<ul data-testid="editions-shortlist" className="mt-3 divide-y divide-border">
					{entries.map((entry) => (
						<ShortlistRow key={entry.id} entry={entry} />
					))}
				</ul>
			) : null}
			<div className="mt-4 flex flex-wrap items-center gap-2">
				<Form method="post" action="/editions">
					<Button
						type="submit"
						disabled={starting}
						variant={entries.length > 0 ? "primary" : "secondary"}
					>
						<Plus className="size-4" aria-hidden />
						{entries.length > 0 ? t("desk.start", { count: entries.length }) : t("desk.startEmpty")}
					</Button>
				</Form>
				{nudging ? snooze.button : null}
			</div>
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

/** The published editions, newest first, by year; unpublished ones among them, marked. */
function PastEditions({ editions, linked }: { editions: LoaderData["past"]; linked: boolean }) {
	const { t } = useTranslation("editions")
	if (editions.length === 0) return null
	return (
		<section aria-labelledby="editions-past" data-testid="editions-past" className="mt-10">
			<div className="flex items-center justify-between gap-2">
				<h2 id="editions-past" className="text-sm font-medium text-muted-fg">
					{t("past.heading")}
				</h2>
				<LinkEditions linked={linked} />
			</div>
			{editions.map((edition, i) => (
				<Fragment key={edition.id}>
					{i === 0 || editions[i - 1]!.year !== edition.year ? (
						<h3 className="mt-3 mb-1 text-xs text-muted-fg">{edition.year}</h3>
					) : null}
					<div
						data-testid="editions-past-row"
						className="flex items-center gap-3 border-t border-border py-2.5"
					>
						<div className="min-w-0 flex-1">
							<Link
								to={`/editions/${edition.id}`}
								className="block truncate font-medium hover:underline"
							>
								{edition.title ?? edition.date}
							</Link>
							<p className="text-sm text-muted-fg">
								{/* Without a title, the date is the title already. */}
								{edition.title ? `${edition.date} · ` : null}
								{t("articles", { count: edition.itemCount })}
							</p>
						</div>
						{edition.state === "unpublished" ? (
							<span className="rounded-md border border-border px-1.5 text-xs text-muted-fg">
								{t("state.unpublished")}
							</span>
						) : edition.changes ? (
							<span className="flex items-center gap-1.5 text-sm text-muted-fg">
								<span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
								{t("changes")}
							</span>
						) : null}
						{edition.publicUrl ? <CopyLink url={edition.publicUrl} /> : null}
					</div>
				</Fragment>
			))}
		</section>
	)
}

function CopyLink({ url }: { url: string }) {
	const { t } = useTranslation("editions")
	return (
		<button
			type="button"
			aria-label={t("editor.copyLink")}
			{...tooltip(t("editor.copyLink"))}
			onClick={() => copyText(url, t("editor.copied"))}
			className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
		>
			<Copy className="size-4" aria-hidden />
		</button>
	)
}

/** Whether public editions link to each other: off by default, each was published on its own. */
function LinkEditions({ linked }: { linked: boolean }) {
	const { t } = useTranslation("editions")
	const fetcher = useFetcher()
	const pending = fetcher.formData?.get("linkEditions")
	const on = pending ? pending === "on" : linked
	const set = (value: "on" | "off") =>
		void fetcher.submit({ linkEditions: value }, { method: "post", action: "/prefs" })
	return (
		<MoreMenu label={t("linking.title")} icon={<Settings2 className="size-4" aria-hidden />}>
			<p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-fg">{t("linking.title")}</p>
			<MenuRadio checked={!on} onSelect={() => set("off")}>
				{t("linking.off")}
			</MenuRadio>
			<MenuRadio checked={on} onSelect={() => set("on")}>
				{t("linking.on")}
			</MenuRadio>
			<p className="max-w-72 px-2 pt-1.5 pb-1 text-xs text-muted-fg">{t("linking.detail")}</p>
		</MoreMenu>
	)
}
