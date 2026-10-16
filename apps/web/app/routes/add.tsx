import { fallbackLanguage, isLocale } from "@klipstack/i18n/languages"
import { Bot, Bookmark, Puzzle, Rss, Smartphone } from "lucide-react"
import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link, redirect, useFetcher } from "react-router"
import { saveArticle, saveLinks, saveStarterText } from "~/commands/saving.server"
import { LinkResults, LinksField } from "~/components/links-field"
import { StarterTexts } from "~/components/starter-texts"
import { Button } from "~/components/ui/button"
import { AppError } from "~/lib/app-error"
import { MCP_RESOURCE } from "~/lib/auth.server"
import { env } from "~/lib/env.server"
import { splitLinks } from "~/lib/links"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { starterTextsFor } from "~/lib/starter-texts.server"
import { cn } from "~/lib/utils"
import { refused } from "~/lib/web-action.server"
import { starterItems } from "~/services/starter-texts.server"
import type { Route } from "./+types/add"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "library:add.button") }]
}

/** Pull a URL out of share-target params: `url`, or the first http(s) link inside `text`/`title`. */
export function sharedUrl(params: URLSearchParams): string | null {
	const direct = params.get("url")?.trim()
	if (direct && /^https?:\/\//i.test(direct)) return direct
	for (const key of ["text", "title", "url"]) {
		const match = /https?:\/\/[^\s<>"']+/i.exec(params.get(key) ?? "")
		if (match) return match[0]
	}
	return null
}

/** A bookmarklet or PWA share pre-fills the form; saving needs an explicit POST. */
export const handle: PageBarHandle = { pageBar: { titleKey: "library:add.title" } }

/** The page's tabs, each its own address (`?tab=`): links first, and by default. */
const TABS = ["links", "read", "more"] as const
type Tab = (typeof TABS)[number]
const isTab = (value: string | null): value is Tab =>
	(TABS as readonly string[]).includes(value ?? "")

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const params = new URL(request.url).searchParams
	const url = sharedUrl(params)
	const tab = params.get("tab")
	const language = isLocale(user.locale) ? user.locale : fallbackLanguage
	return {
		// A shared or bookmarked link always lands on the field.
		tab: url || !isTab(tab) ? ("links" as const) : tab,
		url: url ?? "",
		language,
		starter: await starterItems(user.id, starterTextsFor(language)),
		appUrl: env.APP_URL,
		mcpUrl: MCP_RESOURCE,
		// Connecting an assistant (OAuth) needs a verified address, as API keys do.
		emailVerified: Boolean(user.emailVerified),
	}
}

export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	// A starter text (the empty Home, this page's shelves, the guide's page) instead of a link.
	const starter = form.get("starter")
	const url = String(form.get("url") ?? "")
	const links = splitLinks(url)
	// Several links: each one's outcome, shown here.
	let articleId: string
	try {
		if (typeof starter !== "string" && links.length > 1)
			return { ok: true as const, batch: await saveLinks(user.id, links), url }
		articleId =
			typeof starter === "string"
				? (await saveStarterText(user.id, starter)).articleId
				: (await saveArticle(user.id, { url: links[0] ?? "", source: "web" })).article.id
	} catch (error) {
		if (error instanceof AppError) return refused(error, { url })
		throw error
	}
	throw redirect(`/read/${articleId}`)
}

/**
 * Everything about adding to the library: links (several at once), something to read, the other
 * ways in (phone, bookmarklet, extension, an AI assistant) and blogs to follow. The Save link
 * dialog is the quick way; it links here.
 */
export default function Add({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const { tab } = loaderData
	return (
		<main
			className={cn(
				"mx-auto w-full flex-1 px-4 pt-4 pb-16 md:pt-4",
				tab === "read" ? "max-w-5xl" : "max-w-2xl",
			)}
		>
			<h1 className="hidden page-title md:block md:leading-10">{t("add.title")}</h1>
			<nav
				aria-label={t("add.tabs.label")}
				className="mt-4 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]"
			>
				{TABS.map((name) => (
					<Link
						key={name}
						to={name === "links" ? "/add" : `/add?tab=${name}`}
						aria-current={name === tab ? "page" : undefined}
						className={cn(
							"-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
							name === tab
								? "border-accent text-fg"
								: "border-transparent text-muted-fg hover:text-fg",
						)}
					>
						{t(`add.tabs.${name}`)}
					</Link>
				))}
			</nav>
			{tab === "links" ? <Links url={loaderData.url} actionData={actionData} /> : null}
			{tab === "read" ? (
				<StarterTexts
					items={loaderData.starter}
					language={loaderData.language}
					wide
					className="mt-6"
				/>
			) : null}
			{tab === "more" ? (
				<>
					<Anywhere appUrl={loaderData.appUrl} />
					<Assistant mcpUrl={loaderData.mcpUrl} emailVerified={loaderData.emailVerified} />
					<section aria-labelledby="add-feeds" className="mt-12">
						<h2 id="add-feeds" className="flex items-center gap-2 font-serif text-2xl">
							<Rss className="size-5 text-muted-fg" aria-hidden />
							{t("add.feeds.title")}
						</h2>
						<p className="mt-1 text-sm leading-relaxed text-muted-fg">
							<Trans
								t={t}
								i18nKey="add.feeds.description"
								components={{ feed: <Link to="/feed" className="text-link hover:underline" /> }}
							/>
						</p>
						<p className="mt-3 text-sm leading-relaxed text-muted-fg">{t("add.feeds.importers")}</p>
					</section>
				</>
			) : null}
		</main>
	)
}

/** The field, for one link or several, and each one's outcome. */
function Links({
	url,
	actionData,
}: {
	url: string
	actionData: Route.ComponentProps["actionData"]
}) {
	const { t } = useTranslation("library")
	// A fetcher, not the page's action data: the library's live updates revalidate the page as the
	// links are extracted, and that would clear the outcomes. Without JavaScript, the page's.
	const fetcher = useFetcher<typeof action>()
	const answer = fetcher.data ?? actionData
	const error = answer?.ok === false ? answer.error : null
	const batch = answer?.ok && "batch" in answer ? answer.batch : null
	const refusedLinks = batch?.filter((result) => !result.ok).map((result) => result.url) ?? []
	return (
		<>
			<p className="mt-6 text-sm text-muted-fg">{t("add.description")}</p>
			<fetcher.Form method="post" className="mt-4 flex flex-col gap-4">
				<LinksField
					// After several links, only those not saved stay in the field.
					key={answer ? JSON.stringify(refusedLinks) : "links"}
					defaultValue={batch ? refusedLinks.join("\n") : (answer?.url ?? url)}
					error={error}
					autoFocus
				/>
				<Button type="submit" disabled={fetcher.state !== "idle"}>
					{fetcher.state !== "idle" ? t("add.saving") : t("add.submit")}
				</Button>
			</fetcher.Form>
			{batch ? <LinkResults results={batch} className="mt-4" /> : null}
		</>
	)
}

/** The other ways in: the phone, a bookmarklet, the extension. */
function Anywhere({ appUrl }: { appUrl: string }) {
	const { t } = useTranslation("library")
	const bookmarklet = `javascript:(function(){location.href=${JSON.stringify(`${appUrl}/add?url=`)}+encodeURIComponent(location.href)})()`
	return (
		<section aria-labelledby="add-anywhere" className="mt-12">
			<h2 id="add-anywhere" className="font-serif text-2xl">
				{t("add.anywhere.title")}
			</h2>
			<div className="mt-4 grid gap-3 sm:grid-cols-3">
				<Way icon={Smartphone} title={t("add.anywhere.phone.title")}>
					<p>{t("add.anywhere.phone.android")}</p>
					<p className="mt-2">
						<Soon /> {t("add.anywhere.phone.iphone")}
					</p>
				</Way>
				<Way icon={Bookmark} title={t("add.anywhere.bookmarklet.title")}>
					<p>{t("add.anywhere.bookmarklet.description")}</p>
					<a
						href={bookmarklet}
						draggable
						// A bookmarklet is for dragging to the bookmarks bar, not for clicking here.
						onClick={(e) => e.preventDefault()}
						className="mt-3 inline-block cursor-grab rounded-lg border border-border bg-muted px-3 py-1.5 text-sm font-medium text-fg"
					>
						{t("add.anywhere.bookmarklet.label")}
					</a>
				</Way>
				<Way icon={Puzzle} title={t("add.anywhere.extension.title")}>
					<p>
						<Soon /> {t("add.anywhere.extension.description")}
					</p>
				</Way>
			</div>
		</section>
	)
}

function Way({
	icon: Icon,
	title,
	children,
}: {
	icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
	title: string
	children: React.ReactNode
}) {
	return (
		<div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-fg">
			<h3 className="mb-2 flex items-center gap-2 font-medium text-fg">
				<Icon className="size-4" aria-hidden />
				{title}
			</h3>
			{children}
		</div>
	)
}

function Soon() {
	const { t } = useTranslation("library")
	return (
		<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-fg">
			{t("add.soon")}
		</span>
	)
}

/**
 * An AI assistant that saves to and searches the library (the MCP server, not named so): its
 * address to paste into a chat app's connectors, and instructions for an agent on the computer.
 */
function Assistant({ mcpUrl, emailVerified }: { mcpUrl: string; emailVerified: boolean }) {
	const { t } = useTranslation("library")
	return (
		<section aria-labelledby="add-assistant" className="mt-12">
			<h2 id="add-assistant" className="flex items-center gap-2 font-serif text-2xl">
				<Bot className="size-5 text-muted-fg" aria-hidden />
				{t("add.assistant.title")}
			</h2>
			<p className="mt-1 text-sm leading-relaxed text-muted-fg">{t("add.assistant.description")}</p>
			{emailVerified ? null : (
				<p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
					<Trans
						t={t}
						i18nKey="add.assistant.verify"
						components={{
							account: <Link to="/settings/account" className="text-link hover:underline" />,
						}}
					/>
				</p>
			)}
			<div className="mt-4 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed">
				<h3 className="font-medium">{t("add.assistant.chat.title")}</h3>
				<p className="mt-1 text-muted-fg">{t("add.assistant.chat.steps")}</p>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 [overflow-wrap:anywhere]">
						{mcpUrl}
					</code>
					<CopyButton text={mcpUrl} label={t("add.assistant.chat.copy")} />
				</div>
			</div>
			<div className="mt-3 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed">
				<h3 className="font-medium">{t("add.assistant.agent.title")}</h3>
				<p className="mt-1 text-muted-fg">{t("add.assistant.agent.description")}</p>
				<CopyButton
					text={t("add.assistant.agent.prompt", { url: mcpUrl })}
					label={t("add.assistant.agent.copy")}
					className="mt-3"
				/>
			</div>
		</section>
	)
}

function CopyButton({
	text,
	label,
	className,
}: {
	text: string
	label: string
	className?: string
}) {
	const { t } = useTranslation("library")
	const [copied, setCopied] = useState(false)
	return (
		<Button
			type="button"
			variant="secondary"
			size="sm"
			className={className}
			onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}
		>
			{copied ? t("add.copied") : label}
		</Button>
	)
}
