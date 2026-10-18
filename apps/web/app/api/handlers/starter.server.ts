import type { getStarterOffer, listStarterTexts, saveStarterText } from "@klipstack/api-contract"
import { saveStarterText as saveStarterTextCommand } from "~/commands/saving.server"
import {
	offeredStarterTexts,
	readerStarterLanguage,
	starterShelves,
} from "~/services/starter-texts.server"
import type { Handler } from "../handler.server"

/** The starter texts, as the web's Discover page (`routes/texts`) and Home show them. */

export const list: Handler<typeof listStarterTexts> = async ({ userId, query }) => {
	const readerLanguage = await readerStarterLanguage(userId)
	const language = query.language ?? readerLanguage
	return {
		language,
		readerLanguage,
		...(await starterShelves(userId, readerLanguage, language)),
	}
}

export const offer: Handler<typeof getStarterOffer> = async ({ userId }) =>
	offeredStarterTexts(userId, await readerStarterLanguage(userId))

/** The same command as the web's Discover page. */
export const save: Handler<typeof saveStarterText> = async ({ userId, params }) =>
	saveStarterTextCommand(userId, params.slug, "api")
