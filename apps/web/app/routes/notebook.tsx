import { NotebookPen, Tag } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"
import { ArticleImage } from "~/components/article-image"
import { NotebookNote } from "~/components/notebook-note"
import { SearchField } from "~/components/search-field"
import { formatDay, timeZoneFromCookie } from "~/lib/date-groups"
import { getLocale } from "~/lib/i18n.server"
import { extractLinkIds } from "~/lib/note-links"
import type { PageBarHandle } from "~/lib/page-bar"
import { cursorFields, isCursorTime, isUuid } from "~/lib/page-cursor"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import { linkTargetStatus } from "~/services/links.server"
import { hasAnyNote, listNotebook, notebookTags } from "~/services/notebook.server"
import type { Route } from "./+types/notebook"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.notebook") }]
}

export const handle: PageBarHandle = {
	pageBar: {
		titleKey: "common:nav.notebook",
		search: {
			action: "/notebook",
			clearTo: "/notebook",
			placeholderKey: "reader:notebook.search.placeholder",
			labelKey: "reader:notebook.search.label",
			clearKey: "reader:notebook.search.clear",
		},
	},
}

/** A cursor this page wrote, or null: a bad one shows the first page. */
function decodeCursor(value: string | null) {
	const c = value ? cursorFields(value) : null
	return c && isCursorTime(c.at) && isUuid(c.id) ? { at: c.at, id: c.id } : null
}

/** The page's address with these choices; empty ones are left out. */
function notebookPath({ q, tag, cursor }: { q?: string; tag?: string | null; cursor?: string }) {
	const params = new URLSearchParams()
	if (q) params.set("q", q)
	if (tag) params.set("tag", tag)
	if (cursor) params.set("cursor", cursor)
	const search = params.toString()
	return search ? `/notebook?${search}` : "/notebook"
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const url = new URL(request.url)
	const q = url.searchParams.get("q")?.trim() ?? ""
	const tag = url.searchParams.get("tag")?.trim() || null
	const timeZone = timeZoneFromCookie(request.headers.get("cookie"))
	const [page, tags, anyNote] = await Promise.all([
		listNotebook({
			userId: user.id,
			q,
			tag,
			cursor: decodeCursor(url.searchParams.get("cursor")),
			timeZone,
		}),
		notebookTags(user.id),
		hasAnyNote(user.id),
	])
	// Chips need to know whether their target is still there.
	const linkTargets = await linkTargetStatus(
		user.id,
		extractLinkIds(page.items.map((n) => n.note).join("\n")),
	)
	const locale = getLocale(context)
	return {
		q,
		tag,
		tags,
		anyNote,
		items: page.items.map((n) => ({
			...n,
			noteUpdatedAt: n.noteUpdatedAt?.toISOString() ?? null,
			edited: n.noteUpdatedAt ? formatDay(n.noteUpdatedAt, locale, timeZone) : null,
		})),
		nextCursor: page.nextCursor
			? Buffer.from(JSON.stringify(page.nextCursor)).toString("base64url")
			: null,
		linkTargets,
	}
}

export default function Notebook({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("reader")
	const { t: tc } = useTranslation()
	const { q, tag, tags, anyNote, items, nextCursor, linkTargets } = loaderData
	const location = useLocation()
	const from = location.pathname + location.search
	const heading = q ? t("notebook.search.results", { q }) : tc("nav.notebook")

	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-10 md:pt-4">
			<div className="hidden min-h-10 flex-wrap items-center justify-between gap-3 md:flex">
				<h1 className="text-2xl font-semibold">{heading}</h1>
				{anyNote ? (
					<SearchField
						action="/notebook"
						value={q}
						clearTo={notebookPath({ tag })}
						keep={tag ? { tag } : {}}
						placeholder={t("notebook.search.placeholder")}
						label={t("notebook.search.label")}
						clearLabel={t("notebook.search.clear")}
					/>
				) : null}
			</div>
			{tags.length > 0 || tag ? <TagFilter q={q} tag={tag} tags={tags} /> : null}
			{!anyNote ? (
				<FirstNote />
			) : items.length === 0 ? (
				<p className="mt-12 text-center text-muted-fg md:mt-16">
					{q ? t("notebook.search.empty") : t("notebook.tagEmpty")}
				</p>
			) : (
				<>
					{/* Row by row, so the order reads as it is: most recently edited first. */}
					<ul className="mt-4 grid items-start gap-x-10 sm:grid-cols-2 lg:grid-cols-3 md:mt-6">
						{items.map((n, i) => (
							<li key={n.documentId} data-testid="notebook-note" className="mb-10 pt-3">
								<NotebookNote
									documentId={n.documentId}
									title={n.title}
									note={n.note}
									noteUpdatedAt={n.noteUpdatedAt}
									linkTargets={linkTargets}
									tilt={i}
								/>
								<Link
									to={`/read/${n.documentId}#note`}
									state={{ from }}
									aria-label={t("notebook.open", { title: n.title })}
									className="group mt-1 flex items-center gap-3 rounded-lg p-1 -mx-1 hover:bg-muted"
								>
									<ArticleImage src={n.image} className="size-12 shrink-0 rounded-md" />
									<span className="min-w-0">
										<span className="line-clamp-2 text-sm font-medium leading-snug group-hover:underline">
											{n.title}
										</span>
										<span className="line-clamp-1 text-xs text-muted-fg">
											{[n.siteName, n.edited ? t("notebook.edited", { day: n.edited }) : null]
												.filter(Boolean)
												.join(" · ")}
										</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
					{nextCursor ? (
						<div className="flex justify-center">
							<Link
								to={notebookPath({ q, tag, cursor: nextCursor })}
								className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
							>
								{t("notebook.loadMore")}
							</Link>
						</div>
					) : null}
				</>
			)}
		</main>
	)
}

/** All, then the tags with the most notes; the chosen one stays even when it has none now. */
function TagFilter({
	q,
	tag,
	tags,
}: {
	q: string
	tag: string | null
	tags: Array<{ name: string; notes: number }>
}) {
	const { t } = useTranslation("reader")
	const shown =
		tag && !tags.some((x) => x.name.toLowerCase() === tag.toLowerCase())
			? [...tags, { name: tag, notes: 0 }]
			: tags
	const chip =
		"flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg aria-[current]:border-selected aria-[current]:bg-selected aria-[current]:text-selected-fg"
	return (
		<nav
			aria-label={t("notebook.tags.label")}
			className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:mt-3 md:flex-wrap md:px-0"
		>
			<Link to={notebookPath({ q })} aria-current={tag ? undefined : "true"} className={chip}>
				{t("notebook.tags.all")}
			</Link>
			{shown.map((x) => (
				<Link
					key={x.name}
					to={notebookPath({ q, tag: x.name })}
					aria-current={tag?.toLowerCase() === x.name.toLowerCase() ? "true" : undefined}
					className={chip}
				>
					<Tag className="size-3.5" aria-hidden />
					{x.name}
					{x.notes ? <span className="tabular-nums">{x.notes}</span> : null}
				</Link>
			))}
		</nav>
	)
}

/** No note yet: what a note is, and the way to an article to write one on. */
function FirstNote() {
	const { t } = useTranslation("reader")
	return (
		<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
			<NotebookPen className="size-10" aria-hidden />
			<h2 className="text-lg font-medium text-fg">{t("notebook.empty.title")}</h2>
			<p className="max-w-sm text-sm">{t("notebook.empty.description")}</p>
			<Link
				to="/library"
				className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
			>
				{t("notebook.empty.action")}
			</Link>
		</div>
	)
}
