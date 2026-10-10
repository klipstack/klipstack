import { useCallback, useEffect, useEffectEvent, useInsertionEffect, useRef, useState } from "react"
import { type SubmitTarget, useFetcher } from "react-router"

interface Options<Change, Answer> {
	action: string
	/** The request body of a change. */
	body: (change: Change) => SubmitTarget
	encType?: "application/json" | "application/x-www-form-urlencoded"
	/** Whether the page's data loads again after each change. Routes can still say no. */
	revalidate?: boolean
	/** The server's answer to a change; `undefined` when the request brought none. */
	onSettled?: (change: Change, answer: Answer | undefined) => void
}

/**
 * Changes to one resource, sent one at a time, in order. A fetcher reused for the next change
 * cancels the one still on its way; a fetcher per change lets them reach the server out of order.
 * `pending` holds the changes not answered yet, the first one on its way: the page shows them
 * before the server has them. When the page leaves, changes still waiting are not sent.
 */
export function useMutationQueue<Change, Answer>(options: Options<Change, Answer>) {
	const fetcher = useFetcher<Answer>()
	const [pending, setPending] = useState<Change[]>([])
	const queue = useRef<Change[]>([])
	// The fetcher's answer when the change on its way was sent: any other answer is that change's.
	const sent = useRef<{ before: unknown } | null>(null)
	const latest = useRef({ fetcher, options })
	useInsertionEffect(() => {
		latest.current = { fetcher, options }
	})

	// Stable, so effects that take `submit` do not start over on every render.
	const sendNext = useCallback(() => {
		const change = queue.current[0]
		if (change === undefined || sent.current) return
		const { fetcher, options } = latest.current
		sent.current = { before: fetcher.data }
		void fetcher.submit(options.body(change), {
			method: "post",
			action: options.action,
			encType: options.encType,
			defaultShouldRevalidate: options.revalidate,
		})
	}, [])
	const submit = useCallback(
		(change: Change) => {
			queue.current = [...queue.current, change]
			setPending(queue.current)
			sendNext()
		},
		[sendNext],
	)
	const settle = useEffectEvent(() => {
		if (!sent.current || fetcher.state !== "idle" || fetcher.data === sent.current.before) return
		const [done, ...rest] = queue.current
		queue.current = rest
		sent.current = null
		setPending(rest)
		if (done !== undefined) options.onSettled?.(done, fetcher.data as Answer | undefined)
		sendNext()
	})
	useEffect(() => settle(), [fetcher.state, fetcher.data])

	return { submit, pending }
}
