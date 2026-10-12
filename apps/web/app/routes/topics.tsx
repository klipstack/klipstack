import { TOPIC_NAME_MAX } from "@klipstack/api-contract/names"
import { Pencil, Shapes, Trash2 } from "lucide-react"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher, useRevalidator } from "react-router"
import {
	confirmTopics,
	disableTopics,
	enableTopics,
	markTopicsSeen,
	removeTopic,
	renameTopic,
} from "~/commands/topics.server"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { topicModels } from "~/lib/ai.server"
import { AppError } from "~/lib/app-error"
import { requireFeature } from "~/lib/features.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { showToast } from "~/lib/toast"
import { answer } from "~/lib/web-action.server"
import { type TopicSummary, type TopicsState, topicsState } from "~/services/topics.server"
import type { Route } from "./+types/topics"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.topics") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.topics" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	await requireFeature(user.id, "topics")
	if (!topicModels.available) throw new Response(null, { status: 404 })
	return { state: await topicsState(user.id) }
}

/**
 * POST /topics  intent=enable|disable|seen|confirm|rename|remove. `confirm` takes the proposed
 * topics kept (`keep`, ids) and their names (`name:<id>`); `rename` and `remove` an `id`.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const id = String(form.get("id") ?? "")
	return answer(async () => {
		switch (form.get("intent")) {
			case "enable":
				await enableTopics(user.id)
				return {}
			case "disable":
				await disableTopics(user.id)
				return { disabled: true }
			case "seen":
				await markTopicsSeen(user.id)
				return {}
			case "confirm":
				await confirmTopics(user.id, {
					keep: form.getAll("keep").map((kept) => ({
						id: String(kept),
						name: String(form.get(`name:${kept}`) ?? "") || undefined,
					})),
				})
				return {}
			case "rename":
				return renameTopic(user.id, id, String(form.get("name") ?? ""))
			case "remove":
				return { removed: (await removeTopic(user.id, id)).name }
			default:
				throw new AppError("invalid_request", "Unknown intent.")
		}
	})
}

/** What an action answered, as a fetcher has it: a refusal carries its code. */
type Answered = { ok: true } | { ok: false; error: { code: string; message: string } }

/** Says a refusal in the reader's words. */
function useRefusals(data: Answered | undefined) {
	const { t } = useTranslation("library")
	const words = {
		invalid_request: t("topics.errors.invalid_name"),
		not_found: t("topics.errors.not_found"),
		already_done: t("topics.errors.already_done"),
		forbidden: t("topics.errors.forbidden"),
		unavailable: t("topics.errors.unavailable"),
	} as Record<string, string>
	const onData = useEffectEvent((result: Answered | undefined) => {
		if (!result || result.ok) return
		showToast({ message: words[result.error.code] ?? result.error.message })
	})
	useEffect(() => onData(data), [data])
}

/** The reader's topics, in whichever stage they are: off, waiting, proposing, proposed, active. */
export default function Topics({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const { t: tc } = useTranslation()
	const { state } = loaderData
	// While the worker is on it, the page asks again now and then.
	const { revalidate } = useRevalidator()
	const busy = state.stage === "proposing" || (state.stage === "active" && state.sorting > 0)
	useEffect(() => {
		if (!busy) return
		const id = window.setInterval(() => void revalidate(), 5000)
		return () => window.clearInterval(id)
	}, [busy, revalidate])
	return (
		<main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-8 md:pt-4 md:pb-8">
			<h1 className="hidden text-2xl font-semibold md:block md:leading-10">{tc("nav.topics")}</h1>
			<p className="text-sm text-muted-fg md:mt-2">{t("topics.description")}</p>
			{state.stage === "off" ? <TurnOn state={state} /> : null}
			{state.stage === "waiting" ? (
				<section data-testid="topics-waiting" className="mt-6 rounded-xl border border-border p-4">
					<h2 className="font-medium">{t("topics.waiting.title")}</h2>
					<p className="mt-1 text-sm text-muted-fg">
						{t("topics.waiting.body", { needed: state.needed })}
					</p>
					<progress
						className="mt-3 h-2 w-full accent-accent"
						value={state.count}
						max={state.needed}
						aria-label={t("topics.waiting.progress", { count: state.count, needed: state.needed })}
					/>
					<p className="mt-1 text-xs text-muted-fg">
						{t("topics.waiting.progress", { count: state.count, needed: state.needed })}
					</p>
				</section>
			) : null}
			{state.stage === "proposing" ? (
				<section
					data-testid="topics-proposing"
					className="mt-6 rounded-xl border border-border p-4"
				>
					<h2 className="font-medium">{t("topics.proposing.title")}</h2>
					<p className="mt-1 text-sm text-muted-fg">{t("topics.proposing.body")}</p>
				</section>
			) : null}
			{state.stage === "proposed" ? <Proposal state={state} /> : null}
			{state.stage === "active" ? <TopicList state={state} /> : null}
			{state.stage === "off" ? null : <TurnOff />}
		</main>
	)
}

function TurnOn({ state }: { state: TopicsState }) {
	const { t } = useTranslation("library")
	const fetcher = useFetcher<typeof action>()
	useRefusals(fetcher.data)
	return (
		<section data-testid="topics-off" className="mt-6 rounded-xl border border-border p-4">
			<h2 className="flex items-center gap-2 font-medium">
				<Shapes className="size-4 text-accent" aria-hidden />
				{t("topics.off.title")}
			</h2>
			<p className="mt-2 text-sm">{t("topics.off.body", { needed: state.needed })}</p>
			<p className="mt-2 text-sm text-muted-fg">{t("topics.off.privacy")}</p>
			<fetcher.Form method="post" className="mt-4">
				<input type="hidden" name="intent" value="enable" />
				<Button type="submit" disabled={fetcher.state !== "idle"}>
					{t("topics.off.enable")}
				</Button>
			</fetcher.Form>
		</section>
	)
}

/** The first topics: keep, rename or drop each, then confirm once. */
function Proposal({ state }: { state: TopicsState }) {
	const { t } = useTranslation("library")
	const fetcher = useFetcher<typeof action>()
	useRefusals(fetcher.data)
	// Opening the proposal is seeing it: the sidebar's dot and Home's card go.
	const seen = useFetcher()
	const unseen = state.unseen
	const markSeen = useEffectEvent(() => seen.submit({ intent: "seen" }, { method: "post" }))
	useEffect(() => {
		if (unseen) markSeen()
	}, [unseen])
	if (state.topics.length === 0)
		return (
			<p data-testid="topics-none" className="mt-6 text-sm text-muted-fg">
				{t("topics.proposed.none")}
			</p>
		)
	return (
		<section data-testid="topics-proposal" className="mt-6">
			<h2 className="font-medium">{t("topics.proposed.title")}</h2>
			<p className="mt-1 text-sm text-muted-fg">{t("topics.proposed.body")}</p>
			<fetcher.Form method="post" className="mt-4">
				<input type="hidden" name="intent" value="confirm" />
				<ul className="divide-y divide-border">
					{state.topics.map((topic) => (
						<li key={topic.id} className="flex items-start gap-3 py-3">
							<input
								type="checkbox"
								name="keep"
								value={topic.id}
								defaultChecked
								aria-label={t("topics.proposed.keep", { name: topic.name })}
								className="mt-2.5 size-4 accent-accent"
							/>
							<div className="min-w-0 flex-1">
								<Input
									name={`name:${topic.id}`}
									defaultValue={topic.name}
									maxLength={TOPIC_NAME_MAX}
									aria-label={t("topics.proposed.nameLabel", { name: topic.name })}
									autoComplete="off"
								/>
								<p className="mt-1 text-sm text-muted-fg">{topic.description}</p>
							</div>
						</li>
					))}
				</ul>
				<Button type="submit" className="mt-4" disabled={fetcher.state !== "idle"}>
					{t("topics.proposed.confirm")}
				</Button>
			</fetcher.Form>
		</section>
	)
}

function TopicList({ state }: { state: TopicsState }) {
	const { t } = useTranslation("library")
	const [editingId, setEditingId] = useState<string | null>(null)
	return (
		<>
			{state.sorting > 0 ? (
				<p data-testid="topics-sorting" role="status" className="mt-6 text-sm text-muted-fg">
					{t("topics.sorting", { count: state.sorting })}
				</p>
			) : null}
			{state.topics.length === 0 ? (
				<p data-testid="topics-empty" className="mt-6 text-sm text-muted-fg">
					{t("topics.empty")}
				</p>
			) : (
				<ul data-testid="topics-list" className="mt-6 divide-y divide-border">
					{state.topics.map((topic) => (
						<TopicRow
							key={topic.id}
							topic={topic}
							editing={editingId === topic.id}
							onEdit={() => setEditingId(topic.id)}
							onDone={() => setEditingId((id) => (id === topic.id ? null : id))}
						/>
					))}
				</ul>
			)}
		</>
	)
}

/** A topic: its name (the pencil renames it), its articles, and the way to remove it. */
function TopicRow({
	topic,
	editing,
	onEdit,
	onDone,
}: {
	topic: TopicSummary
	editing: boolean
	onEdit: () => void
	onDone: () => void
}) {
	const { t } = useTranslation("library")
	const fetcher = useFetcher<typeof action>()
	useRefusals(fetcher.data)
	const [armed, setArmed] = useState(false)
	useEffect(() => {
		if (!armed) return
		const id = window.setTimeout(() => setArmed(false), 4000)
		return () => window.clearTimeout(id)
	}, [armed])
	const onAnswer = useEffectEvent((result: typeof fetcher.data) => {
		if (!result?.ok) return
		if ("removed" in result) showToast({ message: t("topics.removed", { name: result.removed }) })
		if (editing) onDone()
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])
	const editRef = useRef<HTMLButtonElement>(null)

	if (fetcher.formData?.get("intent") === "remove") return null
	if (editing)
		return (
			<li className="py-3">
				<fetcher.Form method="post" className="flex gap-2">
					<input type="hidden" name="intent" value="rename" />
					<input type="hidden" name="id" value={topic.id} />
					<Input
						name="name"
						defaultValue={topic.name}
						autoFocus
						onFocus={(e) => e.target.select()}
						onKeyDown={(e) => {
							if (e.key === "Escape") onDone()
						}}
						maxLength={TOPIC_NAME_MAX}
						aria-label={t("topics.proposed.nameLabel", { name: topic.name })}
						autoComplete="off"
						className="min-w-0"
					/>
					<Button type="submit" disabled={fetcher.state !== "idle"}>
						{t("topics.rename")}
					</Button>
					<Button type="button" variant="secondary" onClick={onDone}>
						{t("topics.cancel")}
					</Button>
				</fetcher.Form>
			</li>
		)
	const renamingTo =
		fetcher.formData?.get("intent") === "rename" ? String(fetcher.formData.get("name")) : null
	return (
		<li className="flex flex-wrap items-center gap-2 py-3">
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex min-w-0 items-center gap-1">
					<Link to={`/topics/${topic.id}`} className="min-w-0 truncate font-medium hover:underline">
						{renamingTo?.trim() || topic.name}
					</Link>
					<Button
						ref={editRef}
						type="button"
						variant="ghost"
						size="sm"
						onClick={onEdit}
						aria-label={t("topics.edit", { name: topic.name })}
						{...tooltip(t("topics.rename"))}
						className="shrink-0 text-muted-fg"
					>
						<Pencil className="size-3.5" aria-hidden />
					</Button>
				</span>
				<span className="truncate text-sm text-muted-fg">{topic.description}</span>
			</span>
			<span className="shrink-0 text-sm text-muted-fg">
				{t("topics.articles", { count: topic.articles })}
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
				<input type="hidden" name="intent" value="remove" />
				<input type="hidden" name="id" value={topic.id} />
				<Button
					type="submit"
					variant={armed ? "danger" : "ghost"}
					size="sm"
					aria-label={armed ? undefined : t("topics.remove", { name: topic.name })}
					className={armed ? undefined : "text-muted-fg"}
				>
					<Trash2 className="size-4" aria-hidden />
					{armed ? t("topics.removeConfirm") : null}
				</Button>
			</fetcher.Form>
		</li>
	)
}

/** Turning topics off deletes them: a second tap, as removing a topic. */
function TurnOff() {
	const { t } = useTranslation("library")
	const fetcher = useFetcher<typeof action>()
	useRefusals(fetcher.data)
	const [armed, setArmed] = useState(false)
	useEffect(() => {
		if (!armed) return
		const id = window.setTimeout(() => setArmed(false), 4000)
		return () => window.clearTimeout(id)
	}, [armed])
	const onAnswer = useEffectEvent((result: typeof fetcher.data) => {
		if (result?.ok && "disabled" in result) showToast({ message: t("topics.turnedOff") })
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])
	return (
		<fetcher.Form
			method="post"
			className="mt-10 border-t border-border pt-4"
			onSubmit={(e) => {
				if (!armed) {
					e.preventDefault()
					setArmed(true)
				}
			}}
		>
			<input type="hidden" name="intent" value="disable" />
			<Button type="submit" variant={armed ? "danger" : "secondary"} size="sm">
				{armed ? t("topics.turnOffConfirm") : t("topics.turnOff")}
			</Button>
		</fetcher.Form>
	)
}
