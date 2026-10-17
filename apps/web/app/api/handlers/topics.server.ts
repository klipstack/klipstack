import type {
	confirmTopics as confirmEndpoint,
	countTopicUse as countUseEndpoint,
	disableTopics as disableEndpoint,
	dismissTopicsCard as dismissCardEndpoint,
	enableTopics as enableEndpoint,
	endTopicsInvitation as endInvitationEndpoint,
	markTopicsSeen as seenEndpoint,
	removeTopic as removeEndpoint,
	renameTopic as renameEndpoint,
	takeOutOfTopic as takeOutEndpoint,
} from "@klipstack/api-contract"
import {
	confirmTopics,
	countTopicUse,
	disableTopics,
	dismissTopicsCard,
	enableTopics,
	endTopicsInvitation,
	markTopicsSeen,
	removeTopic,
	renameTopic,
	takeOutOfTopic,
} from "~/commands/topics.server"
import type { Handler } from "../handler.server"

/**
 * Turning topics on and off, confirming and correcting them, as the web's Topics page does: the
 * same commands, so the feature, the providers and the monthly caps hold for every client.
 */

export const enable: Handler<typeof enableEndpoint> = async ({ userId }) => {
	await enableTopics(userId)
}

export const disable: Handler<typeof disableEndpoint> = async ({ userId }) => {
	await disableTopics(userId)
}

export const confirm: Handler<typeof confirmEndpoint> = async ({ userId, body }) => {
	await confirmTopics(userId, body)
}

export const seen: Handler<typeof seenEndpoint> = async ({ userId }) => {
	await markTopicsSeen(userId)
}

export const dismissCard: Handler<typeof dismissCardEndpoint> = async ({ userId }) => {
	await dismissTopicsCard(userId)
}

export const endInvitation: Handler<typeof endInvitationEndpoint> = async ({ userId }) => {
	await endTopicsInvitation(userId)
}

export const rename: Handler<typeof renameEndpoint> = async ({ userId, params, body }) => ({
	topic: await renameTopic(userId, params.id, body.name),
})

export const remove: Handler<typeof removeEndpoint> = async ({ userId, params }) => ({
	topic: await removeTopic(userId, params.id),
})

export const takeOut: Handler<typeof takeOutEndpoint> = async ({ userId, params }) => ({
	topic: await takeOutOfTopic(userId, params.id, params.articleId),
})

export const countUse: Handler<typeof countUseEndpoint> = async ({ userId, body }) => {
	await countTopicUse(userId, body.use)
}
