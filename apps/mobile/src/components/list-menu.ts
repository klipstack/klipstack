import type { NativeStackHeaderItem } from "expo-router/native-stack"
import { useCallback, useSyncExternalStore } from "react"
import { t } from "@/lib/i18n"
import {
	defaultSort,
	type FilterableView,
	type FilterChoice,
	type FilterCounts,
	filterMenu,
	type ListSort,
	sortLabel,
	sortsFor,
} from "@/lib/library-filters"
import { type TopicChoice, type TopicsInList, topicMenu } from "@/lib/library-topics"
import {
	chooseFilter,
	chooseTopic,
	filterOf,
	onTopicChange,
	sortOf,
	topicOf,
} from "@/lib/topic-choices"

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
 * The filter and order a list (`view`) shows, and the ways to change them. The order is the
 * filter's own until the reader chooses another, which then stays across filters, as on the web.
 */
export function useFilterChoice(view: FilterableView | null) {
	const filter = useSyncExternalStore(onTopicChange, () => (view ? filterOf(view) : null))
	const chosenSort = useSyncExternalStore(onTopicChange, () => (view ? sortOf(view) : null))
	const sort = chosenSort ?? defaultSort(filter)
	const setFilter = useCallback(
		(next: FilterChoice) => {
			if (view) chooseFilter(view, next, chosenSort)
		},
		[view, chosenSort],
	)
	const setSort = useCallback(
		(next: ListSort) => {
			if (view) chooseFilter(view, filter, next === defaultSort(filter) ? null : next)
		},
		[view, filter],
	)
	return { filter, sort, setFilter, setSort }
}

/**
 * The header's menu, iOS's take on the web's row of chips: what the list shows (All, and each
 * filter with articles in it, with how many), then Sort (Inbox only) and Topic (for a reader with
 * topics) as submenus that name their choice. Its icon is filled while a filter or a topic is on.
 */
export function listMenuItem(options: {
	view: FilterableView
	counts: FilterCounts | null
	filter: FilterChoice
	sort: ListSort
	topics: TopicsInList | null
	topic: TopicChoice
	chooseFilter: (next: FilterChoice) => void
	chooseSort: (next: ListSort) => void
	chooseTopic: (next: TopicChoice) => void
	tint: string
}): NativeStackHeaderItem {
	const { view, filter, sort, topics, topic } = options
	const show = filterMenu(view, options.counts, filter).map((choice) => ({
		type: "action" as const,
		label: choice.label,
		description: choice.count === null ? undefined : String(choice.count),
		state: choice.on ? ("on" as const) : ("off" as const),
		onPress: () => options.chooseFilter(choice.value),
	}))
	const sorts = sortsFor(view).map((s) => ({
		type: "action" as const,
		label: sortLabel(s),
		state: s === sort ? ("on" as const) : ("off" as const),
		onPress: () => options.chooseSort(s),
	}))
	// Every topic, the reader's topics, and No topic, each a section, as the web's topic choice.
	const [every, ...rest] = topics?.items.length
		? topicMenu(topics, topic).map((choice) => ({
				type: "action" as const,
				label: choice.label,
				description: choice.count ?? undefined,
				state: choice.on ? ("on" as const) : ("off" as const),
				onPress: () => options.chooseTopic(choice.value),
			}))
		: []
	const none = rest.pop()
	const topicChoices =
		every && none
			? [
					every,
					{ type: "submenu" as const, label: "", inline: true, items: rest },
					{ type: "submenu" as const, label: "", inline: true, items: [none] },
				]
			: []
	const on = filter !== null || topic !== null
	return {
		type: "menu",
		label: t("library.menu.show"),
		accessibilityLabel: on ? t("library.menu.showFiltered") : t("library.menu.show"),
		tintColor: options.tint,
		icon: {
			type: "sfSymbol",
			name: on ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle",
		},
		menu: {
			// Each section picks one (Show, Sort, Topic): a single selection here would leave one tick
			// in the whole menu.
			multiselectable: true,
			items: [
				{ type: "submenu", label: t("library.menu.show"), inline: true, items: show },
				...(sorts.length || topicChoices.length
					? [
							{
								type: "submenu" as const,
								label: "",
								inline: true,
								multiselectable: true,
								items: [
									...(sorts.length
										? [
												{
													type: "submenu" as const,
													label: t("library.menu.sort"),
													icon: { type: "sfSymbol" as const, name: "arrow.up.arrow.down" as const },
													items: sorts,
												},
											]
										: []),
									...(topicChoices.length
										? [
												{
													type: "submenu" as const,
													label: t("library.menu.topic"),
													icon: { type: "sfSymbol" as const, name: "square.stack" as const },
													items: topicChoices,
												},
											]
										: []),
								],
							},
						]
					: []),
			],
		},
	}
}
