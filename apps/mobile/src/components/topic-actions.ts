import type { KlipstackClient } from "@klipstack/sdk"
import { Alert } from "react-native"
import { showToast } from "@/lib/article-changes"
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
		"Rename Topic",
		"Topics never rename it again.",
		[
			{ text: "Cancel", style: "cancel" },
			{
				text: "Rename",
				onPress: (value?: string) => {
					const name = value?.trim()
					if (!name || name === topic.name) return
					client.topics
						.rename(topic.id, name)
						.then(({ topic: renamed }) => done(renamed))
						.catch((e: unknown) => showToast({ message: `Not renamed: ${topicRefusal(e)}` }))
				},
			},
		],
		"plain-text",
		topic.name,
	)
}

export function removeTopic(client: KlipstackClient, topic: TopicRef, done: () => void) {
	Alert.alert(
		`Remove “${topic.name}”?`,
		"Its articles leave it, and it won't be proposed again. There is no undo.",
		[
			{ text: "Cancel", style: "cancel" },
			{
				text: "Remove",
				style: "destructive",
				onPress: () =>
					void client.topics
						.remove(topic.id)
						.then(({ topic: removed }) => {
							showToast({ message: `Removed ${removed.name}. It won't be proposed again.` })
							done()
						})
						.catch((e: unknown) => showToast({ message: `Not removed: ${topicRefusal(e)}` })),
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
	Alert.alert("Turn Off Topics?", turnOffQuestion(saved), [
		{ text: "Cancel", style: "cancel" },
		{
			text: "Turn Off",
			style: "destructive",
			onPress: () =>
				void client.topics
					.disable()
					.then(() => {
						showToast({ message: "Topics are off, and deleted." })
						done()
					})
					.catch((e: unknown) => showToast({ message: `Not turned off: ${topicRefusal(e)}` })),
		},
	])
}
