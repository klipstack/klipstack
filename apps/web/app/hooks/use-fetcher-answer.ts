import { useEffect, useEffectEvent, useRef } from "react"

/**
 * Calls `onAnswer` once with each new answer of `fetcher`, after the render that shows it. After
 * every commit, not on `[fetcher.data]`: React skips that effect when another render reads the new
 * data first (remix-run/react-router#15724), and a submission whose states all land in one commit
 * leaves `fetcher.state` as it was. An answer there before the component mounted is not new.
 */
export function useFetcherAnswer<T>(
	fetcher: { state: string; data: T },
	onAnswer: (answer: NonNullable<T>) => void,
) {
	const answer = useEffectEvent(onAnswer)
	const last = useRef(fetcher.data)
	useEffect(() => {
		if (fetcher.data === last.current) return
		last.current = fetcher.data
		if (fetcher.data != null) answer(fetcher.data)
	})
}
