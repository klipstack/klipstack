import { ArrowLeft, CircleMinus } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
	Link,
	type ShouldRevalidateFunctionArgs,
	useFetchers,
	useNavigate,
	useSubmit,
} from "react-router"
import { takeOutOfTopic } from "~/commands/topics.server"
import { DocumentList } from "~/components/document-list"
import { LayoutToggle } from "~/components/layout-toggle"
import { MenuButton } from "~/components/more-menu"
import {
	TopicMenu,
	TopicRemoveConfirm,
	TopicRenameForm,
	useTopicActions,
} from "~/components/topic-actions"
import { useListCursor } from "~/hooks/use-list-cursor"
import { topicModels } from "~/lib/ai.server"
import { AppError } from "~/lib/app-error"
import { requireFeature } from "~/lib/features.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { showToast } from "~/lib/toast"
import { answer } from "~/lib/web-action.server"
import type { LibraryCard } from "~/services/documents.server"
import { topicWithArticles } from "~/services/topics.server"
import type { Route } from "./+types/topics.topic"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.topics") }]
}

export const handle: PageBarHandle = {
	pageBar: { titleKey: "common:nav.topics", layoutToggle: true },
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	await requireFeature(user.id, "topics")
	if (!topicModels.available) throw new Response(null, { status: 404 })
	const found = await topicWithArticles(user.id, params.id).catch(() => null)
	if (!found) throw new Response(null, { status: 404 })
	return found
}

/** POST /topics/:id  intent=take-out, `article`: takes the article out of the topic for good. */
export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	return answer(async () => {
		if (form.get("intent") !== "take-out") throw new AppError("invalid_request", "Unknown intent.")
		const topic = await takeOutOfTopic(user.id, params.id, String(form.get("article") ?? ""))
		return { name: topic.name }
	})
}

/** Removed from its own page, the topic is left for /topics: its loader would only find it gone. */
export function shouldRevalidate({
	formData,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	if (formData?.get("intent") === "remove") return false
	return defaultShouldRevalidate
}

/**
 * A topic's articles, newest first, as the library lists them (list or grid, the same cards), each
 * card's ⋯ with the way to take it out of the topic. The topic's own ⋯ renames or removes it.
 */
export default function TopicPage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const { topic, items } = loaderData
	const navigate = useNavigate()
	const actions = useTopicActions(topic, { onRemoved: () => void navigate("/topics") })
	// Each take-out is a request of its own, so a second one doesn't cancel the first. The cards on
	// their way out are gone already; the toast says so when the reader asks, as archiving does.
	const submit = useSubmit()
	const takeOut = (doc: LibraryCard) => {
		showToast({ message: t("topics.takenOut", { name: actions.name }) })
		void submit(
			{ intent: "take-out", article: doc.id },
			{ method: "post", navigate: false, fetcherKey: `take-out:${doc.id}` },
		)
	}
	const leaving = useFetchers()
		.filter((f) => f.formData?.get("intent") === "take-out")
		.map((f) => String(f.formData?.get("article")))
		.join(",")
	const shown = useMemo(
		() => items.filter((item) => !leaving.split(",").includes(item.id)),
		[items, leaving],
	)
	const ids = useMemo(() => shown.map((item) => item.id), [shown])
	// A topic's page has no selection bar: the cursor only.
	const { cursorId, listRef, onVanish } = useListCursor(ids, undefined, { select: false })
	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-6 md:px-8 md:pt-4 md:pb-8">
			<Link
				to="/topics"
				className="inline-flex items-center gap-1 text-sm text-muted-fg hover:underline"
			>
				<ArrowLeft className="size-4" aria-hidden />
				{t("topics.back")}
			</Link>
			{actions.mode === "rename" ? (
				<div className="mt-2">
					<TopicRenameForm actions={actions} />
				</div>
			) : (
				<div className="mt-2 flex items-center gap-2">
					<h1 data-testid="topic-name" className="min-w-0 flex-1 text-2xl font-semibold">
						{actions.name}
					</h1>
					<LayoutToggle className="hidden md:block" />
					<TopicMenu actions={actions} className="shrink-0 text-muted-fg" />
				</div>
			)}
			{actions.mode === "remove" ? (
				<div className="mt-2">
					<TopicRemoveConfirm actions={actions} />
				</div>
			) : null}
			<p className="mt-1 text-sm text-muted-fg">{topic.description}</p>
			{shown.length === 0 ? (
				<p data-testid="topic-empty" className="mt-8 text-sm text-muted-fg">
					{t("topics.topicEmpty")}
				</p>
			) : (
				<div data-testid="topic-articles">
					<DocumentList
						items={shown}
						listRef={listRef}
						cursorId={cursorId}
						onVanish={onVanish}
						cardMenu={(doc) => (
							<MenuButton
								icon={<CircleMinus className="size-4" aria-hidden />}
								onClick={() => takeOut(doc)}
							>
								{t("topics.takeOutItem")}
							</MenuButton>
						)}
					/>
				</div>
			)}
		</main>
	)
}
