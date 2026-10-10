import { createClient } from "./client"

/**
 * Type checks only, run by `pnpm typecheck` (tsc includes all of `src`; Vitest skips this file):
 * every `@ts-expect-error` line must fail to compile. The function is never called.
 */
export function typeChecks() {
	const client = createClient({ baseUrl: "https://klipstack.test", token: () => "t" })
	// Query values keep their types: enum choices, numbers, booleans (or those as text).
	client.articles.list({ view: "archive", sort: "oldest", limit: 5, filter: "unread" })
	client.articles.list({ limit: "5" })
	client.feed.get({ newOnly: true, perFeed: 3 })
	client.feed.get({ newOnly: "false" })
	// @ts-expect-error a view is one of the view names
	client.articles.list({ view: true })
	// @ts-expect-error sort is a choice, not a number
	client.articles.list({ sort: 123 })
	// @ts-expect-error limit is a number
	client.articles.list({ limit: "potato" })
	// @ts-expect-error newOnly is a boolean
	client.feed.get({ newOnly: 123 })
	// @ts-expect-error feed is an id
	client.feed.get({ feed: false })
	// Required input stays required in the generic call.
	client.call("me.get")
	client.call("articles.get", { params: { id: "x" } })
	client.call("articles.search", { query: { q: "words" } })
	// @ts-expect-error articles.get needs params
	client.call("articles.get")
	// @ts-expect-error articles.save needs a body
	client.call("articles.save", {})
	// @ts-expect-error articles.search needs q
	client.call("articles.search", { query: { limit: 3 } })
	// @ts-expect-error me.get takes no params
	client.call("me.get", { params: { id: "x" } })
}
