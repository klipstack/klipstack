import { useEffect, useState } from "react"

export interface TagOption {
	id: string
	name: string
	articles: number
}

/**
 * The user's tags, from `GET /api/tags`: read on mount, and again whenever `refresh` changes. A
 * plain fetch, not a router fetcher: a load that fails there goes to the error boundary, and
 * offline that would replace a saved article with "You are offline". Here it just finds no tags.
 */
export function useTagList(refresh: unknown): TagOption[] {
	const [tags, setTags] = useState<TagOption[]>([])
	// `refresh` is only a reason to ask again.
	useEffect(() => {
		const controller = new AbortController()
		fetch("/api/tags", { signal: controller.signal })
			.then((res) => (res.ok ? (res.json() as Promise<{ tags?: TagOption[] }>) : null))
			.then((body) => {
				if (body?.tags) setTags(body.tags)
			})
			.catch(() => undefined)
		return () => controller.abort()
	}, [refresh])
	return tags
}
