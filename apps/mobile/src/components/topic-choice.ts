import type { NativeStackHeaderItem } from "expo-router/native-stack"
import { useCallback, useSyncExternalStore } from "react"
import { type TopicChoice, type TopicsInList, topicMenu } from "@/lib/library-topics"
import { chooseTopic, onTopicChange, topicOf } from "@/lib/topic-choices"

/** The topic a list (`view`) shows, and the way to change it; null for a list without topics. */
export function useTopicChoice(view: string | null): [TopicChoice, (next: TopicChoice) => void] {
	const topic = useSyncExternalStore(onTopicChange, () => (view ? topicOf(view) : null))
	const set = useCallback(
		(next: TopicChoice) => {
			if (view) chooseTopic(view, next)
		},
		[view],
	)
	return [topic, set]
}

/**
 * The header's topic menu, as the web's Topic choice: every topic, the reader's topics with what
 * each holds of the list, and No topic; the chosen one ticked. Its icon is filled while a topic is
 * chosen.
 */
export function topicHeaderItem(
	topics: TopicsInList,
	chosen: TopicChoice,
	choose: (next: TopicChoice) => void,
	tint: string,
): NativeStackHeaderItem {
	const [every, ...rest] = topicMenu(topics, chosen).map((choice) => ({
		type: "action" as const,
		label: choice.label,
		description: choice.count ?? undefined,
		state: choice.on ? ("on" as const) : ("off" as const),
		onPress: () => choose(choice.value),
	}))
	const none = rest.pop()!
	return {
		type: "menu",
		label: "Topic",
		accessibilityLabel: chosen ? "Topic, chosen" : "Topic",
		tintColor: tint,
		icon: {
			type: "sfSymbol",
			name: chosen ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle",
		},
		menu: {
			title: "Topic",
			items: [
				every!,
				{ type: "submenu", label: "", inline: true, items: rest },
				{ type: "submenu", label: "", inline: true, items: [none] },
			],
		},
	}
}
