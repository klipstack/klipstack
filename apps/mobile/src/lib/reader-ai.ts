import type { AiAllowance, AiBrief, AiThreadWithMessages, KlipstackClient } from "@klipstack/sdk"
import { useCallback, useEffect, useRef, useState } from "react"
import {
	type AiFailure,
	afterFailure,
	failureOf,
	NOTHING_WRITTEN,
	questionsLeft,
	type Written,
	written,
} from "./ai"

/**
 * The reader's AI for one article: whether the account may ask (the `ai` feature, on a server set
 * up for it), where it stands against its monthly cap, the article's threads and its brief. Nothing
 * is shown without the feature; offline, or on an older server, neither.
 */
export function useReaderAi(client: KlipstackClient | null, articleId: string, ready: boolean) {
	const [enabled, setEnabled] = useState(false)
	const [allowance, setAllowance] = useState<AiAllowance | null>(null)
	const [threads, setThreads] = useState<AiThreadWithMessages[]>([])
	const [brief, setBrief] = useState<AiBrief | null>(null)
	// When the account agreed that questions go to the AI provider; null: ask first.
	const [consentedAt, setConsentedAt] = useState<string | null>(null)
	const live = useRef(true)
	useEffect(() => {
		live.current = true
		return () => {
			live.current = false
		}
	}, [])

	useEffect(() => {
		if (!client || !ready) return
		let current = true
		;(async () => {
			try {
				const status = await client.ai.status()
				if (!current || !status.enabled) return
				const article = await client.ai.article(articleId)
				if (!current) return
				setAllowance(status.allowance)
				setConsentedAt(status.consentedAt ?? null)
				setThreads(article.threads)
				setBrief(article.brief)
				setEnabled(true)
			} catch {
				// No AI here: offline, an older server, or the feature off meanwhile.
			}
		})()
		return () => {
			current = false
		}
	}, [client, articleId, ready])

	/** A refusal: at the cap, none left, whatever the app thought. */
	const failed = useCallback((failure: AiFailure) => {
		setAllowance((now) => afterFailure(now, failure))
	}, [])

	// ---- the brief ----

	const [writing, setWriting] = useState(false)
	const [streamed, setStreamed] = useState<Written>(NOTHING_WRITTEN)
	const [briefFailure, setBriefFailure] = useState<AiFailure | null>(null)
	const busy = useRef(false)
	const latest = useRef(allowance)
	useEffect(() => {
		latest.current = allowance
	}, [allowance])

	/**
	 * Writes the brief, which counts as a question. With none left this month it says why instead,
	 * without asking: the server would refuse it.
	 */
	const makeBrief = useCallback(async () => {
		if (!client || busy.current) return
		if (questionsLeft(latest.current).none) {
			setBriefFailure({ code: "limit_reached" })
			return
		}
		busy.current = true
		setWriting(true)
		setBriefFailure(null)
		setStreamed(NOTHING_WRITTEN)
		try {
			let ended = false
			for await (const event of await client.ai.brief(articleId)) {
				if (!live.current) continue
				if (event.type === "allowance") setAllowance(event.allowance)
				else if (event.type === "brief") {
					ended = true
					if (event.brief) setBrief(event.brief)
					else setBriefFailure({ code: "failed" })
				} else setStreamed((so) => written(so, event))
			}
			// Cut off before the end: the server keeps a brief it finishes, for the next visit.
			if (!ended && live.current) setBriefFailure({ code: "network" })
		} catch (error) {
			const failure = failureOf(error)
			if (live.current) {
				setBriefFailure(failure)
				failed(failure)
			}
		} finally {
			busy.current = false
			if (live.current) setWriting(false)
		}
	}, [client, articleId, failed])

	/** Records on the account that questions may go to the AI provider. Throws when it fails. */
	const consent = useCallback(async () => {
		if (!client) throw new Error("signed out")
		const { consentedAt: at } = await client.ai.consent(true)
		if (live.current) setConsentedAt(at)
	}, [client])

	return {
		enabled,
		allowance,
		consented: consentedAt !== null,
		consent,
		threads,
		setThreads,
		failed,
		setAllowance,
		brief: { brief, writing, streamed, failure: briefFailure, make: makeBrief },
	}
}

export type ReaderAi = ReturnType<typeof useReaderAi>
