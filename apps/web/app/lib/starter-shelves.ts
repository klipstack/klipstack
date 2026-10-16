/**
 * The starter texts' languages and topics (`starter-texts.server.ts` has the texts): here, apart,
 * because pages show them too.
 */
export const STARTER_LANGUAGES = ["en", "es"] as const
export type StarterLanguage = (typeof STARTER_LANGUAGES)[number]

/** The shelves, in the order shown. */
export const STARTER_TOPICS = [
	"reading",
	"stories",
	"living",
	"ideas",
	"science",
	"society",
] as const
export type StarterTopic = (typeof STARTER_TOPICS)[number]

export function isStarterLanguage(value: unknown): value is StarterLanguage {
	return typeof value === "string" && (STARTER_LANGUAGES as readonly string[]).includes(value)
}
