import type { ArticleSummary } from "@klipstack/sdk"
import { minutesLeft } from "./home"
import { dateLocale, t } from "./i18n"

/**
 * A card's line in two parts: where it is from, cut when long, and the reading time, which always
 * shows (`MetaLine`).
 */
export type Meta = { source: string | null; time: string | null }

/**
 * Site and reading time, as the cards show them. On X the site says nothing about who wrote the
 * post, so the author comes along: "X.com · Jane Doe · 3 min".
 */
export function articleMeta(
	item: Pick<ArticleSummary, "site" | "author" | "url" | "readingMinutes">,
): Meta {
	return {
		source: [siteName(item), hostOf(item.url) === "x.com" ? item.author : null]
			.filter(Boolean)
			.join(" · "),
		time: item.readingMinutes ? t("library.meta.minutes", { count: item.readingMinutes }) : null,
	}
}

/** The site's name, or its host without one. */
export function siteName(item: Pick<ArticleSummary, "site" | "url">): string {
	return item.site ?? hostOf(item.url)
}

/**
 * The author and reading time, as a row shows them under the site: the minutes left once reading
 * started, "Jane Doe · 4 min left".
 */
export function articleByline(
	item: Pick<ArticleSummary, "author" | "readingMinutes" | "progress" | "status">,
): Meta {
	const left = item.status === "ready" && item.progress > 0 && item.progress < 1
	const minutes = left ? minutesLeft(item) : item.readingMinutes
	return {
		source: item.author,
		time: minutes
			? left
				? t("library.meta.minutesLeft", { count: minutes })
				: t("library.meta.minutes", { count: minutes })
			: null,
	}
}

/** A date as a row shows it: "Sep 21", with the year when it isn't this one. */
export function shortDate(iso: string | null, now = new Date()): string | null {
	if (!iso) return null
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return null
	return date.toLocaleDateString(dateLocale, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
	})
}

function hostOf(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}
