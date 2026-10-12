import { ArrowLeft, X } from "lucide-react"
import { useEffect, useEffectEvent } from "react"
import { useTranslation } from "react-i18next"
import { type FetcherWithComponents, Link, useFetcher } from "react-router"
import { takeOutOfTopic } from "~/commands/topics.server"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
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

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.topics" } }

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
		const { topic, taken } = await takeOutOfTopic(user.id, params.id, [
			String(form.get("article") ?? ""),
		])
		return { name: topic.name, taken }
	})
}

/** A topic's articles, newest first, each with the way to take it out. */
export default function TopicPage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const { topic, items } = loaderData
	// One fetcher for the page, not one per row: a row taken out is gone once the page loads again,
	// and what it answered is still said.
	const fetcher = useFetcher<typeof action>()
	const onAnswer = useEffectEvent((result: typeof fetcher.data) => {
		if (!result) return
		showToast({
			message: result.ok ? t("topics.takenOut", { name: result.name }) : result.error.message,
		})
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])
	const leaving = fetcher.formData ? String(fetcher.formData.get("article")) : null
	const shown = items.filter((item) => item.id !== leaving)
	return (
		<main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-8 md:pt-4 md:pb-8">
			<Link
				to="/topics"
				className="inline-flex items-center gap-1 text-sm text-muted-fg hover:underline"
			>
				<ArrowLeft className="size-4" aria-hidden />
				{t("topics.back")}
			</Link>
			<h1 data-testid="topic-name" className="mt-2 text-2xl font-semibold">
				{topic.name}
			</h1>
			<p className="mt-1 text-sm text-muted-fg">{topic.description}</p>
			{shown.length === 0 ? (
				<p data-testid="topic-empty" className="mt-8 text-sm text-muted-fg">
					{t("topics.topicEmpty")}
				</p>
			) : (
				<ul data-testid="topic-articles" className="mt-6 divide-y divide-border">
					{shown.map((item) => (
						<ArticleRow key={item.id} item={item} fetcher={fetcher} />
					))}
				</ul>
			)}
		</main>
	)
}

function ArticleRow({
	item,
	fetcher,
}: {
	item: LibraryCard
	fetcher: FetcherWithComponents<unknown>
}) {
	const { t } = useTranslation("library")
	const title = item.title ?? item.siteName ?? item.sourceUrl
	return (
		<li className="flex items-center gap-3 py-3">
			<Link to={`/read/${item.id}`} className="min-w-0 flex-1">
				<span className="block truncate font-medium hover:underline">{title}</span>
				{item.siteName ? (
					<span className="block truncate text-sm text-muted-fg">{item.siteName}</span>
				) : null}
			</Link>
			<fetcher.Form method="post">
				<input type="hidden" name="intent" value="take-out" />
				<input type="hidden" name="article" value={item.id} />
				<Button
					type="submit"
					variant="ghost"
					size="sm"
					disabled={fetcher.state !== "idle"}
					aria-label={t("topics.takeOut", { title })}
					{...tooltip(t("topics.takeOut", { title }))}
					className="text-muted-fg"
				>
					<X className="size-4" aria-hidden />
				</Button>
			</fetcher.Form>
		</li>
	)
}
