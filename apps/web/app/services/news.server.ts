import { MOBILE_CLIENT_ID } from "@klipstack/api-contract/auth"
import { and, db, eq, oauthRefreshToken, type UserPrefs } from "@klipstack/db"
import { desktopBrowser } from "~/lib/extension-url"
import { allNews, newsText, sidebarNews } from "~/lib/news.server"
import { resolvePrefs } from "~/lib/prefs"

/** A card of the sidebar's news stack, in the reader's language. */
export interface SidebarNewsItem {
	slug: string
	/** ISO. */
	date: string
	title: string
	description: string
}

/** The news the sidebar shows this account, in this browser, newest first (`sidebarNews`). */
export async function newsForSidebar(
	user: { id: string; createdAt: Date; prefs?: UserPrefs | null; locale?: unknown },
	headers: Headers,
	now = new Date(),
): Promise<SidebarNewsItem[]> {
	const news = await sidebarNews(allNews(), {
		createdAt: user.createdAt,
		closed: resolvePrefs(user.prefs).newsClosed,
		browser: desktopBrowser(headers),
		usesIphoneApp: () => usesIphoneApp(user.id),
		now,
	})
	return news.map((entry) => {
		const { title, description } = newsText(entry, user.locale)
		return { slug: entry.slug, date: entry.date.toISOString(), title, description }
	})
}

/** Whether the account ever signed in to the iPhone app: it was given a refresh token. */
async function usesIphoneApp(userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: oauthRefreshToken.id })
		.from(oauthRefreshToken)
		.where(
			and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, MOBILE_CLIENT_ID)),
		)
		.limit(1)
	return rows.length > 0
}
