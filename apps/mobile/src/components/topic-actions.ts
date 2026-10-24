import type { KlipstackClient } from "@klipstack/sdk"
import { Alert } from "react-native"
import { showToast } from "@/lib/article-changes"
import { t } from "@/lib/i18n"
import { topicRefusal, turnOffQuestion } from "@/lib/topic-shelves"

/**
 * Renaming and removing a topic, and turning topics off: the web's topic menu and its questions,
 * as iOS's own prompts. Removing and turning off can't be undone, so each asks first, as the web
 * does. Each calls `done` once the server has the change; a refusal is said in a toast.
 */

interface TopicRef {
	id: string
	name: string
}

/** Asks for the new name. Another topic's name is refused, as on the web. */
export function renameTopic(
	client: KlipstackClient,
	topic: TopicRef,
	done: (renamed: TopicRef) => void,
) {
	Alert.prompt(
		t("library.topics.renameTitle"),
		t("library.topics.renameMessage"),
		[
			{ text: t("common.actions.cancel"), style: "cancel" },
			{
				text: t("common.actions.rename"),
				onPress: (value?: string) => {
					const name = value?.trim()
					if (!name || name === topic.name) return
					client.topics
						.rename(topic.id, name)
						.then(({ topic: renamed }) => done(renamed))
						.catch((e: unknown) =>
							showToast({ message: t("library.topics.notRenamed", { reason: topicRefusal(e) }) }),
						)
				},
			},
		],
		"plain-text",
		topic.name,
	)
}

export function removeTopic(client: KlipstackClient, topic: TopicRef, done: () => void) {
	Alert.alert(
		t("library.topics.removeTitle", { name: topic.name }),
		t("library.topics.removeMessage"),
		[
			{ text: t("common.actions.cancel"), style: "cancel" },
			{
				text: t("library.topics.remove"),
				style: "destructive",
				onPress: () =>
					void client.topics
						.remove(topic.id)
						.then(({ topic: removed }) => {
							showToast({ message: t("library.topics.removed", { name: removed.name }) })
							done()
						})
						.catch((e: unknown) =>
							showToast({ message: t("library.topics.notRemoved", { reason: topicRefusal(e) }) }),
						),
			},
		],
	)
}

/** Says which saved searches name topics, which would find nothing in them afterwards. */
export async function turnOffTopics(client: KlipstackClient, done: () => void) {
	const saved = await client.savedSearches
		.list()
		.then((answer) => answer.items)
		.catch(() => [])
	Alert.alert(t("library.topics.turnOffTitle"), turnOffQuestion(saved), [
		{ text: t("common.actions.cancel"), style: "cancel" },
		{
			text: t("library.topics.turnOff"),
			style: "destructive",
			onPress: () =>
				void client.topics
					.disable()
					.then(() => {
						showToast({ message: t("library.topics.turnedOff") })
						done()
					})
					.catch((e: unknown) =>
						showToast({ message: t("library.topics.notTurnedOff", { reason: topicRefusal(e) }) }),
					),
		},
	])
}
