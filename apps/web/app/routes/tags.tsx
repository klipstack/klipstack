import { TAG_NAME_MAX } from "@klipstack/api-contract/names"
import { Pencil, Trash2 } from "lucide-react"
import { useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	type FetcherWithComponents,
	Link,
	useFetcher,
	useLocation,
	useRevalidator,
} from "react-router"
import { deleteTag, renameTag } from "~/commands/tags.server"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { AppError } from "~/lib/app-error"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { tagSearchPath } from "~/lib/search-page"
import { requireUser } from "~/lib/session.server"
import { showToast } from "~/lib/toast"
import { answer } from "~/lib/web-action.server"
import { listSavedSearches, savedSearchNamesByTag } from "~/services/saved-searches.server"
import { listTags, type TagRow } from "~/services/tags.server"
import type { Route } from "./+types/tags"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.tags") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.tags" } }

/** A tag, with the names of the saved searches that name it: deleting it warns about them. */
type TagItem = TagRow & { savedSearches: string[] }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const [tags, searches] = await Promise.all([listTags(user.id), listSavedSearches(user.id)])
	const byTag = savedSearchNamesByTag(searches)
	return {
		tags: tags.map((tag): TagItem => ({
			...tag,
			savedSearches: byTag.get(tag.name.toLowerCase()) ?? [],
		})),
	}
}

/**
 * POST /tags  intent=rename|delete, `id`, `name` or `force`. A rename onto another tag's name merges
 * the two. A delete of a tag saved searches name needs `force`, sent once the page has said so;
 * without it, the refusal `tag_in_saved_searches`. The same commands as the API and MCP.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const id = String(form.get("id") ?? "")
	return answer(async () => {
		switch (form.get("intent")) {
			case "delete":
				await deleteTag(user.id, id, { force: form.get("force") === "true" })
				return { deleted: id }
			case "rename": {
				const { tag, merged } = await renameTag(user.id, id, String(form.get("name") ?? ""))
				return { name: tag.name, merged }
			}
			default:
				throw new AppError("invalid_request", "Unknown intent.")
		}
	})
}

/** Every tag, to rename, merge or delete. A tag's articles are a search away. */
export default function Tags({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const { t: tc } = useTranslation()
	const { tags } = loaderData
	// One tag at a time: opening another one drops what was typed in the first.
	const [editingId, setEditingId] = useState<string | null>(null)
	return (
		<main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-8 md:pt-4 md:pb-8">
			<h1 className="hidden text-2xl font-semibold md:block md:leading-10">{tc("nav.tags")}</h1>
			<p className="text-sm text-muted-fg md:mt-2">{t("tags.page.description")}</p>
			{tags.length === 0 ? (
				<p data-testid="tags-empty" className="mt-8 text-sm text-muted-fg">
					{t("tags.page.empty")}
				</p>
			) : (
				<ul data-testid="tags-list" className="mt-6 divide-y divide-border">
					{tags.map((tag) => (
						<TagRowItem
							key={tag.id}
							tag={tag}
							editing={editingId === tag.id}
							onEdit={() => setEditingId(tag.id)}
							onDone={() => setEditingId((id) => (id === tag.id ? null : id))}
						/>
					))}
				</ul>
			)}
		</main>
	)
}

/**
 * A tag: its name, its articles, and the way to delete it. The pencil turns the name into a field.
 * The fetcher lives here, not in the field: the field goes away once the rename is sent.
 */
function TagRowItem({
	tag,
	editing,
	onEdit,
	onDone,
}: {
	tag: TagItem
	editing: boolean
	onEdit: () => void
	onDone: () => void
}) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const fetcher = useFetcher<typeof action>()
	const { revalidate } = useRevalidator()
	const editRef = useRef<HTMLButtonElement>(null)
	const [failed, setFailed] = useState(false)
	// "Delete" asks for a second tap within a few seconds instead of a dialog. Saved searches that
	// name the tag are said first, with time to read them; the second tap then forces the delete.
	const usedBy = tag.savedSearches
	const warningId = useId()
	const [armed, setArmed] = useState(false)
	useEffect(() => {
		if (!armed) return
		const id = window.setTimeout(() => setArmed(false), usedBy.length > 0 ? 10_000 : 4000)
		return () => window.clearTimeout(id)
	}, [armed, usedBy.length])

	// Back from the field by its own doing (saved, cancelled), the focus goes where it came from.
	// Not when another tag's pencil closed it: the focus belongs to that tag's field.
	const returnFocus = useRef(false)
	useEffect(() => {
		if (editing || !returnFocus.current) return
		returnFocus.current = false
		editRef.current?.focus()
	}, [editing])
	const close = () => {
		returnFocus.current = true
		onDone()
	}

	// Each answer counts once. A bad name keeps the field open and says why; anything else closes it.
	// A delete refused for saved searches made since the page loaded arms again, and the page loads
	// them (a 409 does not): the row then says which.
	const [answered, setAnswered] = useState(fetcher.data)
	if (fetcher.data !== answered) {
		setAnswered(fetcher.data)
		if (fetcher.data && !fetcher.data.ok) {
			if (fetcher.data.error.code === "tag_in_saved_searches") setArmed(true)
			else setFailed(true)
		}
	}
	const onAnswer = useEffectEvent((result: typeof fetcher.data) => {
		if (result && !result.ok && result.error.code === "tag_in_saved_searches") void revalidate()
		if (!result?.ok) return
		if ("merged" in result && result.merged)
			showToast({ message: t("tags.page.merged", { name: result.name }) })
		if (editing) close()
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])

	if (fetcher.formData?.get("intent") === "delete") return null
	const renamingTo =
		fetcher.formData?.get("intent") === "rename" ? String(fetcher.formData.get("name")) : null

	if (editing)
		return (
			<li className="flex flex-wrap items-center gap-2 py-3">
				<TagNameForm
					tag={tag}
					fetcher={fetcher}
					failed={failed}
					onChange={() => setFailed(false)}
					onCancel={() => {
						setFailed(false)
						close()
					}}
				/>
			</li>
		)
	const warning = armed && usedBy.length > 0
	return (
		<li className="flex flex-wrap items-center gap-2 py-3">
			<span className="flex min-w-0 flex-1 items-center gap-1">
				<Link
					to={tagSearchPath(tag.name)}
					state={{ from: location.pathname }}
					className="min-w-0 truncate font-medium hover:underline"
				>
					{renamingTo?.trim() || tag.name}
				</Link>
				<Button
					ref={editRef}
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => {
						setFailed(false)
						setArmed(false)
						onEdit()
					}}
					aria-label={t("tags.page.edit", { name: tag.name })}
					{...tooltip(t("tags.page.rename"))}
					className="shrink-0 text-muted-fg"
				>
					<Pencil className="size-3.5" aria-hidden />
				</Button>
			</span>
			<span className="shrink-0 text-sm text-muted-fg">
				{t("tags.page.articles", { count: tag.articles })}
			</span>
			<fetcher.Form
				method="post"
				onSubmit={(e) => {
					if (!armed) {
						e.preventDefault()
						setArmed(true)
					}
				}}
			>
				<input type="hidden" name="intent" value="delete" />
				<input type="hidden" name="id" value={tag.id} />
				{usedBy.length > 0 ? <input type="hidden" name="force" value="true" /> : null}
				<Button
					type="submit"
					variant={armed ? "danger" : "ghost"}
					size="sm"
					aria-label={armed ? undefined : t("tags.page.deleteNamed", { name: tag.name })}
					aria-describedby={warning ? warningId : undefined}
					className={armed ? undefined : "text-muted-fg"}
				>
					<Trash2 className="size-4" aria-hidden />
					{armed ? t("tags.page.deleteConfirm") : null}
				</Button>
			</fetcher.Form>
			{warning ? (
				<p id={warningId} role="alert" className="w-full text-sm text-danger">
					{t("tags.page.usedBy", { count: usedBy.length, names: usedBy.join(", ") })}
				</p>
			) : null}
		</li>
	)
}

/** The name as a field. Enter renames, Escape gives up. Mounted anew each time, so it starts from the name. */
function TagNameForm({
	tag,
	fetcher,
	failed,
	onChange,
	onCancel,
}: {
	tag: TagRow
	fetcher: FetcherWithComponents<unknown>
	failed: boolean
	onChange: () => void
	onCancel: () => void
}) {
	const { t } = useTranslation("library")
	const [name, setName] = useState(tag.name)
	const changed = name.trim() !== "" && name.trim() !== tag.name
	return (
		<>
			<fetcher.Form
				method="post"
				className="flex min-w-0 flex-1 gap-2"
				onSubmit={(e) => {
					// Enter on the name as it was: nothing to rename.
					if (changed) return
					e.preventDefault()
					onCancel()
				}}
			>
				<input type="hidden" name="intent" value="rename" />
				<input type="hidden" name="id" value={tag.id} />
				<Input
					name="name"
					value={name}
					// The user just asked for this field.
					autoFocus
					onFocus={(e) => e.target.select()}
					onChange={(e) => {
						setName(e.target.value)
						onChange()
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape") onCancel()
					}}
					maxLength={TAG_NAME_MAX}
					aria-label={t("tags.page.nameLabel", { name: tag.name })}
					aria-invalid={failed ? true : undefined}
					autoComplete="off"
					className="min-w-0"
				/>
				<Button type="submit" disabled={!changed || fetcher.state !== "idle"}>
					{t("tags.page.rename")}
				</Button>
				<Button type="button" variant="secondary" onClick={onCancel}>
					{t("tags.page.cancel")}
				</Button>
			</fetcher.Form>
			{failed ? (
				<p role="alert" className="w-full text-sm text-danger">
					{t("tags.errors.invalid_name")}
				</p>
			) : null}
		</>
	)
}
