import { fallbackLanguage, isLocale, supportedLanguages } from "@klipstack/i18n"
import type { NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { ArrowLeft, Copy, Eye, Maximize2, Monitor, Newspaper, Smartphone, X } from "lucide-react"
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Link, redirect, useFetcher, useNavigate, useRevalidator } from "react-router"
import { EditionArticle, type Reading } from "~/components/edition-article"
import { EditionItemCard, type EditionSave, errorText } from "~/components/edition-item-card"
import { EditionPage } from "~/components/edition-page"
import { AddShortlist, EditionPicker } from "~/components/edition-picker"
import { EditionTextField } from "~/components/edition-text-field"
import { tooltip } from "~/components/tooltip-host"
import { Button, buttonVariants } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { AutosaveGroup, AutosaveGroupContext, useAutosaveText } from "~/hooks/use-autosave-text"
import { useEditionScrollSync } from "~/hooks/use-edition-scroll-sync"
import { AppError } from "~/lib/app-error"
import { copyText } from "~/lib/copy-link"
import { formatDay } from "~/lib/date-groups"
import { type EditionDone, editionAction } from "~/lib/edition-action.server"
import {
	EDITION_INTRO_MAX,
	EDITION_TITLE_MAX,
	editionState,
	formatEditionDate,
	hasUnpublishedChanges,
	publishProblems,
} from "~/lib/editions"
import { env } from "~/lib/env.server"
import { getInstance } from "~/lib/i18n.server"
import { fitsKeepalive } from "~/lib/keepalive"
import type { PageBarHandle } from "~/lib/page-bar"
import { resolvePrefs } from "~/lib/prefs"
import { readFields } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { cn } from "~/lib/utils"
import { answer } from "~/lib/web-action.server"
import type { WebResult } from "~/lib/web-result"
import { getEdition, pickerDocuments, previewView } from "~/services/editions.server"
import type { Route } from "./+types/editions.edit"

export function meta({ loaderData }: Route.MetaArgs) {
	return [{ title: `${loaderData?.view.title ?? "Edition"} · Klipstack` }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.editions" } }

/** Another user's edition, or none: the same 404. */
function notFound(error: unknown): never {
	if (error instanceof AppError && error.code === "not_found") throw data(null, { status: 404 })
	throw error
}

export async function loader({ params, context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const locale = isLocale(user.locale) ? user.locale : fallbackLanguage
	const [working, picker] = await Promise.all([
		getEdition(user.id, params.id),
		pickerDocuments(user.id, params.id),
	]).catch(notFound)
	return {
		...working,
		picker,
		// Marked for the next edition, and not in this one yet.
		missing: picker.shortlist.filter((doc) => !doc.added).length,
		// Formatted here: Node and browsers format dates differently, which breaks hydration.
		publishedOn: working.edition.publishedAt
			? formatEditionDate(working.edition.publishedAt, locale, working.edition.timeZone)
			: null,
		state: editionState(working.edition),
		changes: hasUnpublishedChanges(working.edition),
		// Taken down by an admin: why, as the owner's email said. The date is formatted here too.
		removed: working.edition.removedAt
			? {
					on: formatDay(working.edition.removedAt, locale, "UTC"),
					ground: working.edition.removedGround ?? "other",
					note: working.edition.removedNote ?? "",
				}
			: null,
		publicUrl: working.publicPath ? `${env.APP_URL}${working.publicPath}` : null,
		// The article pane reads in the reader's font.
		readerFont: resolvePrefs(user.prefs).font,
		// The side-by-side preview. Every save reads the page's data again, and this with it.
		view: await previewView(
			user.id,
			working.edition,
			working.items,
			user.name,
			getInstance(context).getFixedT(working.edition.locale, "editions"),
		),
	}
}

/**
 * POST /editions/:id — intents: update, add-item, add-shortlist, update-item, move-item,
 * remove-item, refresh-item, publish, unpublish, delete (the command `changeEdition`), and
 * restore-item, the toast's undo of remove-item (`editionAction`).
 */
export async function action({ params, context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	let deleted = false
	const answered = await answer(async () => {
		const done = await editionAction(user.id, params.id, await readFields(request))
		deleted = Boolean(done.deleted)
		return done
	})
	if (deleted) throw redirect("/editions")
	return answered
}

/** Saves through `/editions/:id/save`, then reads the page's data again ("unpublished changes"). */
function useEditionSave(editionId: string): EditionSave {
	const { revalidate } = useRevalidator()
	return useCallback(
		async (body, keepalive) => {
			const json = JSON.stringify(body)
			const res = await fetch(`/editions/${editionId}/save`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: json,
				keepalive: keepalive && fitsKeepalive(json),
			})
			if (!res.ok) throw new Error(`edition save failed: ${res.status}`)
			if (!keepalive) void revalidate()
			return (await res.json()) as WebResult<EditionDone>
		},
		[editionId, revalidate],
	)
}

/**
 * The working copy: title, intro and language, the articles, and where to add more; beside it, on
 * a wide page, the preview.
 */
export default function EditionEditor({ loaderData }: Route.ComponentProps) {
	const { edition, items } = loaderData
	const [group] = useState(() => new AutosaveGroup())
	const save = useEditionSave(edition.id)
	const added = useMemo(
		() => new Set(items.flatMap((item) => (item.documentId ? [item.documentId] : []))),
		[items],
	)
	// Wide enough (the page, not the window: the sidebar takes its share), the preview sits beside
	// the editor and scrolls on its own, to the article the editor is at.
	const editorColumn = useRef<HTMLElement>(null)
	const previewScroller = useRef<HTMLDivElement>(null)
	useEditionScrollSync(editorColumn, previewScroller)
	// The article open beside the editor, while its item is still in the edition. Only that item's
	// card stays within reach; the rest of the editor waits until the article closes.
	const [reading, setReading] = useState<Reading | null>(null)
	// Its item removed, the article closes, and an undo does not open it again.
	if (reading && !items.some((item) => item.id === reading.itemId)) setReading(null)
	// Counts every request: the article scrolls to a highlight asked for again.
	const requests = useRef(0)
	// Where the focus was when the article opened, to go back to when it closes.
	const opener = useRef<HTMLElement | null>(null)
	const read = useCallback((itemId: string, highlightId: string | null) => {
		const asked = ++requests.current
		if (document.activeElement instanceof HTMLElement) opener.current = document.activeElement
		setReading((open) =>
			// Read again, the open article closes.
			open?.itemId === itemId && highlightId === null ? null : { itemId, highlightId, asked },
		)
	}, [])
	const close = useCallback(() => {
		setReading(null)
		const back = opener.current
		opener.current = null
		// Once the editor is within reach again.
		requestAnimationFrame(() => {
			if (back?.isConnected) back.focus({ preventScroll: true })
		})
	}, [])
	// Escape closes the article from anywhere, unless something nearer (a menu, a popover) took it.
	useEffect(() => {
		if (!reading) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) close()
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [reading, close])
	return (
		<AutosaveGroupContext value={group}>
			<div className="@container flex w-full min-w-0 flex-1 flex-col">
				<div className="flex flex-1 flex-col @5xl:flex-row">
					<EditorColumn
						data={loaderData}
						save={save}
						added={added}
						mainRef={editorColumn}
						reading={reading?.itemId ?? null}
						onRead={read}
					/>
					<SidePane
						data={loaderData}
						reading={reading}
						onClose={close}
						previewRef={previewScroller}
					/>
				</div>
			</div>
		</AutosaveGroupContext>
	)
}

/** Title, intro and language, the articles, and where to add more. */
function EditorColumn({
	data: loaderData,
	save,
	added,
	mainRef,
	reading,
	onRead,
}: {
	data: Route.ComponentProps["loaderData"]
	save: EditionSave
	added: ReadonlySet<string>
	mainRef: React.Ref<HTMLElement>
	/** The item whose article is open beside the editor. */
	reading: string | null
	onRead: (itemId: string, highlightId: string | null) => void
}) {
	const { t } = useTranslation("editions")
	const { edition, items, picker, missing } = loaderData
	// Set aside: kept in place, left out of the page.
	const aside = items.filter((item) => !item.included).length
	// While an article is open, all but its card wait, dimmed and out of reach (`inert`).
	const away = reading !== null
	const waiting = cn("transition-opacity", away && "opacity-40")
	return (
		<main
			ref={mainRef}
			className="mx-auto w-full max-w-3xl flex-1 px-4 pt-3 pb-16 md:pt-4 md:pb-8 @5xl:mx-0 @5xl:w-[32rem] @5xl:max-w-none @5xl:flex-none @5xl:px-6 @6xl:w-[36rem]"
		>
			<div data-testid="edition-editor-top" inert={away} className={waiting}>
				<Link
					to="/editions"
					className="inline-flex items-center gap-1 text-sm text-muted-fg hover:text-fg md:h-10"
				>
					<ArrowLeft className="size-4" aria-hidden />
					{t("editor.back")}
				</Link>
				<PublishPanel data={loaderData} />
				<EditionFields edition={edition} save={save} />
			</div>
			<section aria-labelledby="edition-items" className="mt-10">
				<div inert={away} className={cn("flex items-center justify-between gap-3", waiting)}>
					<h2 id="edition-items" className="text-lg font-semibold">
						{t("articles", { count: items.length - aside })}
						{aside > 0 ? (
							<span className="font-normal text-muted-fg">
								{" · "}
								{t("setAside", { count: aside })}
							</span>
						) : null}
					</h2>
					<EditionPicker editionId={edition.id} picker={picker} added={added} />
				</div>
				{missing > 0 ? (
					<div
						data-testid="edition-shortlist-more"
						inert={away}
						className={cn(
							"mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted px-3 py-2 text-sm",
							waiting,
						)}
					>
						<Newspaper className="size-4 shrink-0 text-muted-fg" aria-hidden />
						<span className="flex-1">{t("shortlist.more", { count: missing })}</span>
						<AddShortlist editionId={edition.id} count={missing} />
					</div>
				) : null}
				{items.length === 0 ? (
					<p className="mt-2 text-sm text-muted-fg">{t("editor.noItems")}</p>
				) : (
					<ol data-testid="edition-items" className="mt-3 space-y-4">
						{items.map((item, i) => (
							<EditionItemCard
								key={item.id}
								editionId={edition.id}
								item={item}
								first={i === 0}
								last={i === items.length - 1}
								save={save}
								reading={reading === item.id}
								away={away && reading !== item.id}
								onRead={(highlightId) => onRead(item.id, highlightId)}
							/>
						))}
					</ol>
				)}
			</section>
		</main>
	)
}

/** Saves what is still being typed, then opens the full-page preview. */
function useOpenPreview(editionId: string) {
	const group = useContext(AutosaveGroupContext)
	const navigate = useNavigate()
	return async (e: React.MouseEvent) => {
		e.preventDefault()
		await group?.flushAll()
		void navigate(`/editions/${editionId}/preview`)
	}
}

/**
 * Beside the editor, on a wide page: the public page as it would look, the working copy after its
 * last save, at desktop width or at a phone's, since the page sizes itself to its container. An
 * item's article, once opened, shows instead until it is closed; on a narrow page it takes the
 * screen.
 */
function SidePane({
	data,
	reading,
	onClose,
	previewRef,
}: {
	data: Route.ComponentProps["loaderData"]
	reading: Reading | null
	onClose: () => void
	previewRef: React.Ref<HTMLDivElement>
}) {
	const { t } = useTranslation("editions")
	const { edition, items, view, readerFont } = data
	const [phone, setPhone] = useState(false)
	const openPreview = useOpenPreview(edition.id)
	const item = reading ? items.find((i) => i.id === reading.itemId) : undefined
	const articleScroller = useRef<HTMLDivElement>(null)
	const pane = useRef<HTMLElement>(null)

	// On a narrow page the article covers the editor: focus goes with it.
	useEffect(() => {
		const aside = pane.current
		if (reading && aside && getComputedStyle(aside).position === "fixed")
			aside.querySelector<HTMLElement>("[data-close-article]")?.focus()
	}, [reading])

	return (
		<aside
			ref={pane}
			aria-label={reading ? t("article.pane") : t("preview.pane")}
			className={cn(
				"min-w-0 flex-1 flex-col border-l border-border @5xl:sticky @5xl:flex @5xl:h-dvh",
				// On a narrow page the article covers the editor; on a wide one it sits beside it.
				reading
					? "fixed inset-0 z-40 flex bg-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] @5xl:right-auto @5xl:bottom-auto @5xl:left-auto @5xl:z-auto @5xl:bg-transparent @5xl:p-0"
					: "sticky top-0 hidden h-dvh",
			)}
		>
			<div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:h-14">
				{reading && item ? (
					<div className="min-w-0">
						<p className="text-sm font-medium">{t("article.pane")}</p>
						<p className="truncate text-xs text-muted-fg">{item.title}</p>
					</div>
				) : (
					<div className="min-w-0">
						<p className="text-sm font-medium">{t("preview.pane")}</p>
						<p className="truncate text-xs text-muted-fg">{t("preview.paneDetail")}</p>
					</div>
				)}
				<div className="ml-auto flex shrink-0 items-center gap-1">
					{!reading ? (
						<>
							{(
								[
									[false, Monitor, t("preview.desktop")],
									[true, Smartphone, t("preview.phone")],
								] as const
							).map(([value, Icon, label]) => (
								<Button
									key={label}
									variant="ghost"
									size="icon"
									aria-label={label}
									aria-pressed={phone === value}
									{...tooltip(label)}
									onClick={() => setPhone(value)}
									className={cn(phone === value && "bg-muted text-fg")}
								>
									<Icon className="size-4" aria-hidden />
								</Button>
							))}
							<Link
								to={`/editions/${edition.id}/preview`}
								onClick={openPreview}
								aria-label={t("preview.fullPage")}
								{...tooltip(t("preview.fullPage"))}
								className={buttonVariants({ variant: "ghost", size: "icon" })}
							>
								<Maximize2 className="size-4" aria-hidden />
							</Link>
						</>
					) : null}
					{reading ? (
						<Button
							variant="ghost"
							size="icon"
							data-close-article
							aria-label={t("article.close")}
							{...tooltip(t("article.close"))}
							onClick={onClose}
						>
							<X className="size-4" aria-hidden />
						</Button>
					) : null}
				</div>
			</div>
			{/* Kept, hidden, while the article shows: the editor's scroll sync holds on to it. */}
			<div
				ref={previewRef}
				className={cn(
					"min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/40",
					reading && "hidden",
				)}
			>
				<div
					className={cn(
						phone &&
							"mx-auto my-6 w-[390px] max-w-[calc(100%-2rem)] overflow-hidden rounded-[2rem] border border-border shadow-xl",
					)}
				>
					<EditionPage view={view} newTab />
				</div>
			</div>
			{reading && item ? (
				<div
					ref={articleScroller}
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-bg"
				>
					<EditionArticle
						editionId={edition.id}
						reading={reading}
						fallbackUrl={item.url}
						font={readerFont}
						scrollRef={articleScroller}
					/>
				</div>
			) : null}
		</aside>
	)
}

/**
 * Where the edition stands (draft, published, unpublished; changes not yet public) and what can be
 * done about it. Publishing sends what is still being typed first, so none of it is left out.
 */
function PublishPanel({ data }: { data: Route.ComponentProps["loaderData"] }) {
	const { t } = useTranslation("editions")
	const { edition, items, publishedOn, state, changes, publicUrl, removed } = data
	const group = useContext(AutosaveGroupContext)
	const fetcher = useFetcher<WebResult<{ deleted?: true }>>()
	const busy = fetcher.state !== "idle"

	const run = async (intent: "publish" | "unpublish" | "delete", question?: string) => {
		if (question && !confirm(question)) return
		await group?.flushAll()
		void fetcher.submit({ intent }, { method: "post", encType: "application/json" })
	}
	const preview = useOpenPreview(edition.id)

	// After a refused publish, what still stands in the way, as the page's data now says.
	const refused = !busy && fetcher.data?.ok === false ? fetcher.data : null
	const problems = refused?.error.code === "publish_problems" ? publishProblems(items) : []
	const titleOf = (itemId: string) => items.find((item) => item.id === itemId)?.title ?? ""

	const publishLabel =
		state === "draft"
			? t("editor.publish")
			: state === "live"
				? t("editor.update")
				: t("editor.publishAgain")

	return (
		<div data-testid="edition-status" className="mt-4 rounded-xl border border-border bg-card p-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<span
					className={cn(
						"rounded-full px-2.5 py-0.5 text-xs font-medium",
						state === "live" ? "bg-accent text-accent-fg" : "bg-muted text-muted-fg",
					)}
				>
					{t(`state.${state}`)}
				</span>
				{publishedOn ? (
					<span className="text-sm text-muted-fg">
						{t("editor.publishedOn", { date: publishedOn })}
					</span>
				) : null}
				{state !== "draft" && changes ? (
					<span className="text-sm text-warn">{t("changes")}</span>
				) : null}
				<div className="ml-auto flex gap-2">
					<Link
						to={`/editions/${edition.id}/preview`}
						onClick={preview}
						// Beside the preview pane, which opens the full page itself.
						className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "@5xl:hidden")}
					>
						<Eye className="size-4" aria-hidden />
						{t("editor.preview")}
					</Link>
					<Button
						size="sm"
						disabled={busy || Boolean(removed) || (state === "live" && !changes)}
						onClick={() => void run("publish")}
					>
						{publishLabel}
					</Button>
				</div>
			</div>

			{state === "live" && publicUrl ? (
				<div className="mt-3 flex items-center gap-2">
					<span className="text-sm text-muted-fg">{t("editor.publicLink")}</span>
					<a
						href={publicUrl}
						data-testid="edition-public-link"
						className="min-w-0 flex-1 truncate text-sm text-link hover:underline"
					>
						{publicUrl}
					</a>
					<Button variant="ghost" size="sm" onClick={() => copyText(publicUrl, t("editor.copied"))}>
						<Copy className="size-4" aria-hidden />
						{t("editor.copyLink")}
					</Button>
				</div>
			) : null}
			{state === "live" && changes ? (
				<p className="mt-2 text-sm text-muted-fg">{t("editor.changesDetail")}</p>
			) : null}
			{removed ? (
				<div role="status" className="mt-3 text-sm text-danger">
					<p>
						{t("removal.notice", {
							date: removed.on,
							ground: t(`removal.grounds.${removed.ground}`),
						})}
					</p>
					{removed.note ? (
						<p className="mt-1">{t("removal.note", { note: removed.note })}</p>
					) : null}
				</div>
			) : state === "unpublished" ? (
				<p className="mt-2 text-sm text-muted-fg">{t("editor.unpublishedDetail")}</p>
			) : null}

			{problems.length > 0 ? (
				<div role="alert" className="mt-3 text-sm text-danger">
					<p className="font-medium">{t("editor.problems")}</p>
					<ul className="mt-1 list-disc pl-5">
						{problems.map((problem) => (
							<li key={`${problem.code}:${"itemId" in problem ? problem.itemId : ""}`}>
								{problem.code === "url" || problem.code === "quotes"
									? t(`problems.${problem.code}`, { title: titleOf(problem.itemId) })
									: t(`problems.${problem.code}`)}
							</li>
						))}
					</ul>
				</div>
			) : refused && refused.error.code !== "publish_problems" ? (
				<p role="alert" className="mt-3 text-sm text-danger">
					{errorText(t, refused.error)}
				</p>
			) : null}

			<div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
				{state === "live" ? (
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => void run("unpublish", t("editor.unpublishConfirm"))}
					>
						{t("editor.unpublish")}
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					className="text-danger"
					onClick={() => void run("delete", t("editor.deleteConfirm"))}
				>
					{t("editor.delete")}
				</Button>
			</div>
		</div>
	)
}

/** Title and intro save themselves as you type; the language saves when chosen. */
function EditionFields({
	edition,
	save,
}: {
	edition: Route.ComponentProps["loaderData"]["edition"]
	save: EditionSave
}) {
	const { t } = useTranslation("editions")
	const { t: tc } = useTranslation()
	const id = useId()
	const title = useAutosaveText(edition.title ?? "", async (text, { keepalive }) => {
		await save({ intent: "update", title: text }, keepalive)
	})
	const intro = useAutosaveText(edition.intro ?? "", async (text, { keepalive }) => {
		await save({ intent: "update", intro: text }, keepalive)
	})
	const language = useFetcher<WebResult<{ deleted?: true }>>()
	return (
		<div className="mt-6 space-y-5">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-title`}>{t("editor.titleLabel")}</Label>
				<Input
					id={`${id}-title`}
					value={title.value}
					maxLength={EDITION_TITLE_MAX}
					onChange={(e) => title.change(e.target.value)}
					onBlur={title.flush}
					placeholder={t("editor.titlePlaceholder")}
					aria-describedby={title.value.trim() ? undefined : `${id}-title-hint`}
					autoComplete="off"
					className="h-11 font-serif text-lg"
				/>
				{/* The placeholder is a suggestion, not what an empty title publishes: the date. */}
				{title.value.trim() ? null : (
					<p id={`${id}-title-hint`} className="text-xs text-muted-fg">
						{t("editor.titleHint")}
					</p>
				)}
			</div>
			<div className="flex flex-col gap-1.5">
				<Label id={`${id}-intro-label`} htmlFor={`${id}-intro`}>
					{t("editor.introLabel")}
				</Label>
				<EditionTextField
					id={`${id}-intro`}
					aria-labelledby={`${id}-intro-label`}
					value={intro.value}
					maxLength={EDITION_INTRO_MAX}
					placeholder={t("editor.introPlaceholder")}
					onChange={intro.change}
					onBlur={intro.flush}
					className="min-h-[5.5rem] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</div>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${id}-locale`}>{t("editor.language")}</Label>
					<select
						id={`${id}-locale`}
						defaultValue={edition.locale}
						aria-describedby={`${id}-locale-hint`}
						onChange={(e) =>
							language.submit(
								{ intent: "update", locale: e.target.value },
								{ method: "post", encType: "application/json" },
							)
						}
						className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{supportedLanguages.map((lng) => (
							<option key={lng} value={lng}>
								{tc(`language.${lng}`)}
							</option>
						))}
					</select>
					<p id={`${id}-locale-hint`} className="text-xs text-muted-fg">
						{t("editor.languageHint")}
					</p>
				</div>
				<SaveStatus statuses={[title.status, intro.status]} />
			</div>
		</div>
	)
}

/** One word for several fields: an error wins, then saving, then saved. */
function SaveStatus({ statuses }: { statuses: NoteSaveStatus[] }) {
	const { t } = useTranslation("editions")
	const status = (["error", "saving", "saved"] as const).find((s) => statuses.includes(s))
	return (
		<p
			role="status"
			className={cn("text-xs", status === "error" ? "text-danger" : "text-muted-fg")}
		>
			{status === "error"
				? t("editor.saveError")
				: status === "saving"
					? t("editor.saving")
					: status === "saved"
						? t("editor.saved")
						: null}
		</p>
	)
}
