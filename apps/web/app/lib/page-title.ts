/**
 * Page titles in the reader's language. `meta` runs without the i18n instance, so the root loader
 * sends these names translated, and each page picks its own. Safe to import from client code.
 */
export const PAGE_TITLES = [
	"common:nav.admin",
	"common:nav.archive",
	"common:nav.editions",
	"common:nav.feed",
	"common:nav.notebook",
	"common:nav.inbox",
	"common:nav.search",
	"common:nav.settings",
	"common:nav.starred",
	"common:nav.tags",
	"common:nav.topics",
	"common:nav.trash",
	"library:review.title",
	"library:starter.title",
	"settings:about.title",
	"settings:account.title",
	"settings:apiKeys.title",
	"settings:appearance.title",
	"settings:capture.title",
	"settings:connectedApps.title",
	"settings:data.title",
	"settings:shortcuts.title",
	"settings:usage.title",
	"auth:login.title",
	"auth:magicLink.title",
	"auth:oauth.title",
	"auth:resetPassword.requestTitle",
	"auth:resetPassword.title",
	"auth:signup.title",
] as const

export type PageTitle = (typeof PAGE_TITLES)[number]

/** A route's `meta` match; typegen leaves unmatched slots undefined. */
type Match = { id: string; loaderData: unknown } | undefined

/** "Name · Klipstack", with the name the root loader sent for `key`. */
export function pageTitle(matches: readonly Match[], key: PageTitle): string {
	const root = matches.find((match) => match?.id === "root")?.loaderData as
		| { titles?: Partial<Record<PageTitle, string>> }
		| undefined
	const name = root?.titles?.[key]
	return name ? `${name} · Klipstack` : "Klipstack"
}
