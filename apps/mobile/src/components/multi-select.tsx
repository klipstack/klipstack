import type { ArticleSummary } from "@klipstack/sdk"
import { useFocusEffect } from "expo-router"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { Keyboard } from "react-native"
import type { Selection } from "@/components/article-card"
import { HeaderTextButton } from "@/components/tab-stack"
import { t } from "@/lib/i18n"
import { setTabBarHidden } from "@/lib/tab-bar"

const NONE: ReadonlySet<string> = new Set()

/**
 * Multi-select for a screen of articles (the library's lists, search), as the web's on a phone:
 * Select starts it (`start`), taps check articles (`selection`), the header offers Select All and
 * Done (`header`), and the screen's selection bar takes the tab bar's place. Leaving the screen
 * ends it. Only what is on screen can be checked: an article that leaves the screen (moved away
 * by an action, or gone after a reload) leaves the selection.
 */
export function useMultiSelect(items: ArticleSummary[] | null) {
	const [selecting, setSelecting] = useState(false)
	const [checked, setChecked] = useState<ReadonlySet<string>>(NONE)
	// A new object each time, so the same words twice still show again.
	const [notice, setNotice] = useState<{ text: string } | null>(null)
	// What left the screen leaves the selection, as the list changes (React's way to adjust state
	// to a prop: during render, not in an effect).
	const [seen, setSeen] = useState(items)
	if (items !== seen) {
		setSeen(items)
		const shown = new Set(items?.map((a) => a.id))
		const left = [...checked].filter((id) => shown.has(id))
		if (left.length !== checked.size) setChecked(new Set(left))
	}
	const cards = (items ?? []).filter((a) => checked.has(a.id))
	const allChecked = items !== null && items.length > 0 && cards.length === items.length

	const toggle = useCallback((id: string) => {
		setChecked((prev) => {
			const next = new Set(prev)
			if (!next.delete(id)) next.add(id)
			return next
		})
	}, [])
	const selection = useMemo<Selection | null>(
		() => (selecting ? { checked, toggle } : null),
		[selecting, checked, toggle],
	)

	/** Starts selecting, with `first` checked (the long-press menu's Select) or nothing. */
	const start = useCallback((first?: ArticleSummary) => {
		Keyboard.dismiss()
		setSelecting(true)
		setChecked(first ? new Set([first.id]) : NONE)
		setNotice(null)
	}, [])
	const stop = useCallback(() => {
		setSelecting(false)
		setChecked(NONE)
		setNotice(null)
	}, [])

	// The selection bar takes the tab bar's place; leaving the screen ends the selection.
	useEffect(() => {
		if (!selecting) return
		setTabBarHidden(true)
		return () => setTabBarHidden(false)
	}, [selecting])
	useFocusEffect(useCallback(() => stop, [stop]))

	useEffect(() => {
		if (!notice) return
		const timer = setTimeout(() => setNotice(null), 2500)
		return () => clearTimeout(timer)
	}, [notice])

	const header: { headerLeft: () => ReactNode; headerRight: () => ReactNode } | null = selecting
		? {
				headerLeft: () =>
					items?.length ? (
						<HeaderTextButton
							label={allChecked ? t("library.select.none") : t("library.select.all")}
							onPress={() => setChecked(allChecked ? NONE : new Set(items.map((a) => a.id)))}
						/>
					) : null,
				headerRight: () => (
					<HeaderTextButton label={t("common.actions.done")} strong onPress={stop} />
				),
			}
		: null

	return {
		selecting,
		/** The checked articles on screen. */
		cards,
		selection,
		start,
		stop,
		/** The header's buttons while selecting; null otherwise, for the screen's own. */
		header,
		/** What the last action did, shown for a moment in the selection bar. */
		notice: notice?.text ?? null,
		say: useCallback((text: string) => setNotice({ text }), []),
	}
}
