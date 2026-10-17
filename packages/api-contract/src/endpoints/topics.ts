import { z } from "zod"
import { defineEndpoint, empty, json } from "../endpoint"
import { TOPIC_USES } from "../enums"
import { PROPOSED_TOPICS_MAX } from "../names"
import { Id, TopicName } from "../schemas"

/**
 * Turning the reader's automatic topics on and off, confirming the first ones and correcting them,
 * as the web's Topics page does. GET /topics says which stage they are in. Changing topics needs
 * the account's `topics` feature (`forbidden` otherwise); what sends article text to the AI
 * providers (turning them on, confirming) also needs a server with them (`unavailable`). Turning
 * topics off needs neither.
 */

const params = z.object({ id: Id })

export const enableTopics = defineEndpoint({
	id: "topics.enable",
	method: "POST",
	path: "/topics/enable",
	scope: "write",
	summary:
		"Turns topics on: from now on, article text is sent to TypeSafe and Anthropic to sort it. Ends Home's invitation to them. Turning them on again while on changes nothing.",
	response: empty(),
	errors: ["forbidden", "unavailable"],
})

export const disableTopics = defineEndpoint({
	id: "topics.disable",
	method: "POST",
	path: "/topics/disable",
	scope: "write",
	summary:
		"Turns topics off and deletes them: every topic, where each article was, and what was taken out. There is no undo. Saved searches that name topics find nothing in them afterwards. Works without the feature too.",
	response: empty(),
	errors: [],
})

export const confirmTopics = defineEndpoint({
	id: "topics.confirm",
	method: "POST",
	path: "/topics/confirm",
	scope: "write",
	summary:
		"Confirms the first topics (GET /topics while `proposed`): the ones in `keep`, each under its new `name` if one is given; the others are removed and never proposed again. Then the library is sorted into them.",
	body: z.object({
		keep: z.array(z.object({ id: Id, name: TopicName.optional() })).max(PROPOSED_TOPICS_MAX),
	}),
	response: empty(),
	/**
	 * `not_found`: nothing waits to be confirmed, or a kept id is none of the proposed topics.
	 * `already_done`: confirmed already. `name_taken`: two kept topics would have one name.
	 */
	errors: ["not_found", "already_done", "name_taken", "forbidden", "unavailable"],
})

export const markTopicsSeen = defineEndpoint({
	id: "topics.seen",
	method: "POST",
	path: "/topics/seen",
	scope: "write",
	summary:
		"The reader opened the first topics: Home's card about them (`card` in GET /topics) goes, here and on the web.",
	response: empty(),
	errors: ["forbidden"],
})

export const dismissTopicsCard = defineEndpoint({
	id: "topics.dismissCard",
	method: "POST",
	path: "/topics/card/dismiss",
	scope: "write",
	summary:
		'"Not now" on Home\'s card about the first topics: the card goes; the topics still wait to be confirmed.',
	response: empty(),
	errors: ["forbidden"],
})

export const endTopicsInvitation = defineEndpoint({
	id: "topics.endInvitation",
	method: "POST",
	path: "/topics/invitation/end",
	scope: "write",
	summary:
		'Ends Home\'s invitation to turn topics on (`invitation` in GET /topics), for good: "No thanks" on it, or the offer to turn them on seen.',
	response: empty(),
	errors: ["forbidden"],
})

const TopicRef = z.object({ id: Id, name: z.string() })

export const renameTopic = defineEndpoint({
	id: "topics.rename",
	method: "PATCH",
	path: "/topics/:id",
	scope: "write",
	summary:
		"Renames a topic in use. The name is the reader's from then on: topics never rename it. Saved searches that name the topic follow it. Another topic's name, whatever its case, is `name_taken`.",
	params,
	body: z.object({ name: TopicName }),
	response: json(z.object({ topic: TopicRef })),
	errors: ["not_found", "name_taken", "forbidden"],
})

export const removeTopic = defineEndpoint({
	id: "topics.remove",
	method: "DELETE",
	path: "/topics/:id",
	scope: "write",
	summary:
		"Removes a topic in use: its articles leave it, and it is never proposed again. There is no undo.",
	params,
	response: json(z.object({ topic: TopicRef })),
	errors: ["not_found", "forbidden"],
})

export const takeOutOfTopic = defineEndpoint({
	id: "topics.takeOut",
	method: "DELETE",
	path: "/topics/:id/articles/:articleId",
	scope: "write",
	summary:
		"Takes an article out of a topic, for good: sorting never puts it back in that topic. `not_found` for a topic not in use, or an article in the trash or not the user's.",
	params: z.object({ id: Id, articleId: Id }),
	response: json(z.object({ topic: TopicRef })),
	errors: ["not_found", "forbidden"],
})

export const countTopicUse = defineEndpoint({
	id: "topics.countUse",
	method: "POST",
	path: "/topics/use",
	scope: "write",
	summary:
		"Counts one use of a part of topics this month, for the server's administrators: its name only, no article and no topic.",
	body: z.object({ use: z.enum(TOPIC_USES) }),
	response: empty(),
	errors: ["forbidden"],
})
