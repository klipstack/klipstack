import { TOPIC_NAME_MAX } from "@klipstack/api-contract/names"
import { topicKey, topicsNamedIn } from "@klipstack/api-contract/search-query"
import { Pencil, Trash2 } from "lucide-react"
import { useEffect, useEffectEvent, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useRouteLoaderData } from "react-router"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { showToast } from "~/lib/toast"
import type { loader as layoutLoader } from "~/routes/app-layout"
import type { action } from "~/routes/topics"
import { MenuButton, MoreMenu } from "./more-menu"

/** What the Topics action answered, as a fetcher has it: a refusal carries its code. */
type Answered = { ok: true } | { ok: false; error: { code: string; message: string } }

/** Says a refusal of the Topics action in the reader's words. */
export function useTopicRefusals(data: Answered | undefined) {
	const { t } = useTranslation("library")
	const { t: tc } = useTranslation()
	const words = {
		name_taken: t("topics.errors.name_taken"),
		invalid_request: t("topics.errors.invalid_name"),
		not_found: t("topics.errors.not_found"),
		already_done: t("topics.errors.already_done"),
		forbidden: t("topics.errors.forbidden"),
		unavailable: t("topics.errors.unavailable"),
	} as Record<string, string>
	const onData = useEffectEvent((result: Answered | undefined) => {
		if (!result || result.ok) return
		showToast({ message: words[result.error.code] ?? tc("errors.generic") })
	})
	useEffect(() => onData(data), [data])
}

interface Topic {
	id: string
	name: string
}

export type TopicActions = ReturnType<typeof useTopicActions>

/**
 * Renaming and removing a topic, wherever it shows: the Topics page and the topic's own. Both post
 * to the Topics action. `mode` is what the topic shows instead of its name: the rename field, or the
 * question before removing; sending either closes it, and a refusal is said in a toast. `onRemoved`
 * runs once the topic is gone.
 */
export function useTopicActions(topic: Topic, { onRemoved }: { onRemoved?: () => void } = {}) {
	const { t } = useTranslation("library")
	const fetcher = useFetcher<typeof action>()
	useTopicRefusals(fetcher.data)
	const [mode, setMode] = useState<"rename" | "remove" | null>(null)
	const onAnswer = useEffectEvent((result: typeof fetcher.data) => {
		if (!result?.ok) return
		if ("removed" in result) {
			showToast({ message: t("topics.removed", { name: result.removed }) })
			onRemoved?.()
		}
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])
	const intent = fetcher.formData?.get("intent")
	return {
		topic,
		fetcher,
		mode,
		setMode,
		/** On its way out: the page shows it gone already. */
		removing: intent === "remove",
		/** The name as the reader sees it: the new one while the rename is on its way. */
		name: (intent === "rename" && String(fetcher.formData?.get("name")).trim()) || topic.name,
	}
}

/** ⋯ for a topic: Rename and Remove. */
export function TopicMenu({ actions, className }: { actions: TopicActions; className?: string }) {
	const { t } = useTranslation("library")
	return (
		<MoreMenu label={t("topics.more", { name: actions.name })} className={className}>
			<MenuButton
				icon={<Pencil className="size-4" aria-hidden />}
				onClick={() => actions.setMode("rename")}
			>
				{t("topics.rename")}
			</MenuButton>
			<MenuButton
				icon={<Trash2 className="size-4" aria-hidden />}
				danger
				onClick={() => actions.setMode("remove")}
			>
				{t("topics.removeItem")}
			</MenuButton>
		</MoreMenu>
	)
}

/** The topic's name as a field: Enter or Rename saves it, Escape or Cancel leaves it. */
export function TopicRenameForm({ actions }: { actions: TopicActions }) {
	const { t } = useTranslation("library")
	const { fetcher, topic } = actions
	return (
		<fetcher.Form
			method="post"
			action="/topics"
			onSubmit={() => actions.setMode(null)}
			className="flex flex-wrap gap-2"
		>
			<input type="hidden" name="intent" value="rename" />
			<input type="hidden" name="id" value={topic.id} />
			<Input
				name="name"
				defaultValue={topic.name}
				autoFocus
				onFocus={(e) => e.target.select()}
				onKeyDown={(e) => {
					if (e.key === "Escape") actions.setMode(null)
				}}
				maxLength={TOPIC_NAME_MAX}
				aria-label={t("topics.proposed.nameLabel", { name: topic.name })}
				autoComplete="off"
				className="min-w-0 flex-1 basis-48"
			/>
			<Button type="submit" disabled={fetcher.state !== "idle"}>
				{t("topics.rename")}
			</Button>
			<Button type="button" variant="secondary" onClick={() => actions.setMode(null)}>
				{t("topics.cancel")}
			</Button>
		</fetcher.Form>
	)
}

/**
 * Removing is for good: the topic asks first, in place, and names the saved searches that would
 * find nothing in it, as deleting a tag does.
 */
export function TopicRemoveConfirm({ actions }: { actions: TopicActions }) {
	const { t } = useTranslation("library")
	const { fetcher, topic } = actions
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")
	const key = topicKey(topic.name)
	const naming = (layout?.savedSearches ?? [])
		.filter((s) => topicsNamedIn(s.query).some((name) => topicKey(name) === key))
		.map((s) => s.name)
	return (
		<fetcher.Form
			method="post"
			action="/topics"
			onSubmit={() => actions.setMode(null)}
			role="group"
			aria-label={t("topics.remove", { name: actions.name })}
			className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted px-3 py-2 text-sm"
		>
			<input type="hidden" name="intent" value="remove" />
			<input type="hidden" name="id" value={topic.id} />
			<p className="min-w-0 flex-1 basis-56">
				{t("topics.removeAsk", { name: actions.name })}
				{naming.length > 0 ? (
					<span className="mt-1 block text-danger">
						{t("topics.removeSaved", { count: naming.length, names: naming.join(", ") })}
					</span>
				) : null}
			</p>
			<span className="flex gap-2">
				<Button
					type="submit"
					variant="danger"
					size="sm"
					autoFocus
					disabled={fetcher.state !== "idle"}
				>
					{t("topics.removeItem")}
				</Button>
				<Button type="button" variant="secondary" size="sm" onClick={() => actions.setMode(null)}>
					{t("topics.cancel")}
				</Button>
			</span>
		</fetcher.Form>
	)
}
