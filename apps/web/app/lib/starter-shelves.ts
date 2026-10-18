import { STARTER_LANGUAGES, type StarterLanguage } from "@klipstack/api-contract/enums"

/**
 * The starter texts' languages and topics (`starter-texts.server.ts` has the texts): in the API's
 * contract, because pages and the API's clients show them too.
 */
export {
	STARTER_LANGUAGES,
	STARTER_TOPICS,
	type StarterLanguage,
	type StarterTopic,
} from "@klipstack/api-contract/enums"

export function isStarterLanguage(value: unknown): value is StarterLanguage {
	return typeof value === "string" && (STARTER_LANGUAGES as readonly string[]).includes(value)
}
