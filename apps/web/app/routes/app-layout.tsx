import { fallbackLanguage } from "@klipstack/i18n/languages"
import { Outlet, type ShouldRevalidateFunctionArgs, useRouteLoaderData } from "react-router"
import { AppShell } from "~/components/app-shell"
import { EmailVerification } from "~/components/email-verification"
import { ErrorContent } from "~/components/error-content"
import { looksLikeAdmin } from "~/lib/admin.server"
import { topicModels } from "~/lib/ai.server"
import { MCP_RESOURCE } from "~/lib/auth.server"
import { emailEnabled } from "~/lib/email.server"
import { env } from "~/lib/env.server"
import { extensionUrl } from "~/lib/extension-url"
import { listFeatures } from "~/lib/features.server"
import { resolvePrefs } from "~/lib/prefs"
import { requireUser } from "~/lib/session.server"
import { isStarterLanguage } from "~/lib/starter-shelves"
import { starterGuide } from "~/lib/starter-texts.server"
import { editionNudge } from "~/services/editions.server"
import { countNewFeedItems } from "~/services/feeds.server"
import { newsForSidebar } from "~/services/news.server"
import { extensionOffered, gettingStarted } from "~/services/onboarding.server"
import { listSavedSearches } from "~/services/saved-searches.server"
import { firstTopicsNotice, hasTopics, missingTopics } from "~/services/topics.server"
import type { Route } from "./+types/app-layout"

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const prefs = resolvePrefs(user.prefs)
	const editions = prefs.editions === "on"
	const feeds = prefs.feeds === "on"
	const [feedNew, nudge, savedSearches, features, steps] = await Promise.all([
		feeds ? countNewFeedItems(user.id) : 0,
		editions ? editionNudge(user.id) : null,
		listSavedSearches(user.id).then(async (searches) => {
			// A saved search that names a topic the reader no longer has finds nothing in it.
			const ended = await missingTopics(
				user.id,
				searches.map((s) => s.query),
			)
			return searches.map((s, i) => ({ ...s, endedTopics: ended[i] ?? [] }))
		}),
		listFeatures(user.id),
		gettingStarted(user.id, {
			extension: extensionOffered(request.headers),
		}),
	])
	// No news while Getting started is on: it is a new account's first steps, and all it needs.
	const news = steps ? [] : await newsForSidebar(user, request.headers)
	// Topics show for an account with the feature, on a server with both providers' keys; and for
	// one that has topics still, to turn them off.
	const topics =
		features.includes("topics") && topicModels.available
			? { unseen: (await firstTopicsNotice(user.id)).dot }
			: (await hasTopics(user.id))
				? { unseen: false }
				: null
	return {
		user: {
			id: user.id,
			name: user.name,
			email: user.email,
			locale: user.locale,
			emailVerified: user.emailVerified,
		},
		emailEnabled,
		// Shows the Admin menu link. No admin data belongs in this loader.
		isAdmin: looksLikeAdmin(user),
		// Feeds turned on in Settings → Features: their link, and the dot for new posts.
		feeds,
		// Contact support, on a server with a SuppyHQ account. Not for admins, verified or not: they run
		// the support.
		support: env.SUPPYHQ_TENANT && user.role !== "admin" ? { tenant: env.SUPPYHQ_TENANT } : null,
		feedNew,
		// Editions turned on in Settings → Features: their link, and the reader's ways to them.
		editions,
		// A new edition is due: the dot beside Editions.
		editionDue: !!nudge?.reason,
		// The sidebar's section and the command menu. This loader runs again after every action, so a
		// saved, renamed or deleted search shows at once; so does a tag rename that rewrote a query.
		savedSearches,
		// Features in testing turned on for this account: their links show only then.
		features,
		topics,
		// The Getting started card: its steps, the extension page, and the guide to highlight in.
		gettingStarted: steps
			? {
					steps,
					extensionUrl: extensionUrl(env.APP_URL),
					guide: starterGuide(isStarterLanguage(user.locale) ? user.locale : fallbackLanguage).slug,
				}
			: null,
		// The sidebar's news stack, newest on top.
		news,
		// The Save link dialog: its bookmarklet, and the address an AI assistant connects to.
		appUrl: env.APP_URL,
		mcpUrl: MCP_RESOURCE,
	}
}

/**
 * Skip the round trip on plain navigations (the shared account and navigation data rarely change);
 * re-run after actions and on explicit revalidations (live updates, pull to refresh).
 */
export function shouldRevalidate({
	formMethod,
	currentUrl,
	nextUrl,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	if (formMethod) return defaultShouldRevalidate
	return currentUrl.href === nextUrl.href
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
	return (
		<AppShell
			user={loaderData.user}
			feeds={loaderData.feeds}
			feedNew={loaderData.feedNew}
			editions={loaderData.editions}
			editionDue={loaderData.editionDue}
			topics={loaderData.topics}
			gettingStarted={loaderData.gettingStarted}
			news={loaderData.news}
			savedSearches={loaderData.savedSearches}
			support={loaderData.support}
			notice={
				!loaderData.user.emailVerified ? (
					<div className="mx-4 mt-4 rounded-xl border border-accent/30 bg-card p-4 md:mx-8">
						<EmailVerification
							email={loaderData.user.email}
							verified={false}
							emailEnabled={loaderData.emailEnabled}
						/>
					</div>
				) : null
			}
		>
			<Outlet />
		</AppShell>
	)
}

/** A failing page (offline, 404, crash) keeps the sidebar, top bar and drawer around it. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const data = useRouteLoaderData<typeof loader>("routes/app-layout")
	return (
		<AppShell
			user={data?.user ?? { name: "", email: "" }}
			feeds={data?.feeds ?? false}
			feedNew={data?.feedNew ?? 0}
			editions={data?.editions ?? false}
			editionDue={data?.editionDue ?? false}
			topics={data?.topics ?? null}
			gettingStarted={data?.gettingStarted ?? null}
			news={data?.news ?? []}
			savedSearches={data?.savedSearches ?? []}
			support={data?.support ?? null}
		>
			<ErrorContent error={error} />
		</AppShell>
	)
}
