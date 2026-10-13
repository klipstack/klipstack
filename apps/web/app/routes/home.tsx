import "@fontsource-variable/newsreader"
import { ArrowRight } from "lucide-react"
import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link } from "react-router"
import { EditionPreview } from "~/components/landing/edition-preview"
import { HighlightDemo } from "~/components/landing/highlight-demo"
import { InviteForm } from "~/components/landing/invite-form"
import { INITIAL_MARKS, type Marks } from "~/components/landing/sample"
import { PublicPage } from "~/components/public-page"
import { buttonVariants } from "~/components/ui/button"
import { env, invitesRequired } from "~/lib/env.server"
import { getInstance } from "~/lib/i18n.server"
import { formToken, INVITE_REQUEST_NOTE_MAX } from "~/lib/invite-requests.server"
import { getSession } from "~/lib/session.server"
import { shareCard } from "~/lib/share-card.server"
import type { Route } from "./+types/home"

export async function loader({ context }: Route.LoaderArgs) {
	const i18n = getInstance(context)
	const t = i18n.getFixedT(null, "common")
	const loggedIn = Boolean(getSession(context))
	const waitlist = !loggedIn && env.SIGNUP_MODE === "waitlist"
	return {
		loggedIn,
		inviteOnly: invitesRequired,
		// The invite forms post to /request-invite, which checks this token's age.
		invite: waitlist ? { token: formToken(), noteMax: INVITE_REQUEST_NOTE_MAX } : null,
		// The hero headline without its markup.
		title: `${t("appName")} · ${t("home.headline").replace(/<[^>]+>/g, "")}`,
		description: t("home.description"),
		url: `${env.APP_URL}/`,
		card: shareCard(i18n.language),
	}
}

export function meta({ loaderData }: Route.MetaArgs) {
	if (!loaderData) return [{ title: "Klipstack" }]
	const { title, description, url, card } = loaderData
	return [
		{ title },
		{ name: "description", content: description },
		// Link previews (chat apps, social sites): the branded card with the page's words.
		{ property: "og:type", content: "website" },
		{ property: "og:site_name", content: "Klipstack" },
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:url", content: url },
		{ property: "og:image", content: card.url },
		{ property: "og:image:width", content: String(card.width) },
		{ property: "og:image:height", content: String(card.height) },
		{ property: "og:image:alt", content: title },
		{ name: "twitter:card", content: "summary_large_image" },
	]
}

const steps = ["save", "read", "mark", "publish"] as const
const extras = ["find", "ask", "assistant", "phone"] as const
/** Extras in testing, or not out yet, and their badge. */
const badges: Partial<
	Record<
		(typeof extras)[number],
		"home.steps.ask.badge" | "home.steps.assistant.badge" | "home.steps.phone.badge"
	>
> = {
	ask: "home.steps.ask.badge",
	assistant: "home.steps.assistant.badge",
	phone: "home.steps.phone.badge",
}
const commitments = ["private", "export", "delete", "source", "copy", "assistant"] as const
const questions = ["free", "invite", "import", "apps", "extension", "privacy"] as const

const eyebrow = "text-xs font-semibold tracking-[0.08em] text-muted-fg uppercase"
const sectionTitle = "font-display text-3xl tracking-tight text-balance sm:text-4xl"

export default function Home({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	const { loggedIn, inviteOnly, invite } = loaderData
	// The hero's highlights, which the sample edition quotes.
	const [marks, setMarks] = useState<Marks>(INITIAL_MARKS)
	return (
		<PublicPage loggedIn={loggedIn}>
			<main className="pb-20">
				<section className="grid gap-10 pt-4 pb-16 sm:pt-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-end lg:gap-16 lg:pb-24">
					<div>
						{inviteOnly ? <p className={eyebrow}>{t("home.hero.eyebrow")}</p> : null}
						<h1 className="mt-4 font-display text-[clamp(3.1rem,8.6vw,7.75rem)] leading-[0.94] font-[640] tracking-[-0.03em] text-balance">
							<Trans
								i18nKey="home.headline"
								components={{
									mark: <mark className="marker swipe" />,
									em: <em className="font-[480] tracking-[-0.02em]" />,
								}}
							/>
						</h1>
					</div>
					<div className="max-w-xl">
						<p className="text-lg leading-relaxed text-muted-fg">
							{t("home.description")} {t("home.hero.lede")}
						</p>
						<div className="mt-8">
							{invite ? (
								<>
									<InviteForm token={invite.token} noteMax={invite.noteMax} />
									<p className="mt-3 text-sm text-muted-fg">
										{t("home.hero.admission")} {t("home.hero.haveCode")}{" "}
										<Link to="/signup" className="text-link hover:underline">
											{t("home.signup")}
										</Link>
									</p>
								</>
							) : (
								<div className="flex flex-wrap items-center gap-x-4 gap-y-3">
									<Link
										to={loggedIn ? "/home" : "/signup"}
										className={buttonVariants({ size: "lg" })}
									>
										{t(loggedIn ? "home.openApp" : "home.signup")}
										<ArrowRight className="size-4" aria-hidden />
									</Link>
									{loggedIn || !inviteOnly ? null : (
										<span className="text-sm text-muted-fg">{t("home.inviteOnly")}</span>
									)}
								</div>
							)}
						</div>
					</div>
				</section>

				<section
					aria-labelledby="try"
					className="grid items-start gap-10 border-t border-border pt-14 pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14"
				>
					<div className="lg:pt-6">
						<p className={eyebrow}>{t("home.try.eyebrow")}</p>
						<h2 id="try" className={`mt-3 ${sectionTitle}`}>
							{t("home.try.title")}
						</h2>
						<p className="mt-5 max-w-xl leading-relaxed">{t("home.try.description")}</p>
					</div>
					<HighlightDemo marks={marks} onChange={setMarks} />
				</section>

				<section
					aria-labelledby="editions"
					className="grid items-start gap-10 border-t border-border pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14"
				>
					<div className="lg:pt-6">
						<p className={eyebrow}>{t("home.edition.eyebrow")}</p>
						<h2 id="editions" className={`mt-3 ${sectionTitle}`}>
							{t("home.edition.title")}
						</h2>
						<p className="mt-5 max-w-xl leading-relaxed">{t("home.edition.description")}</p>
						<p className="mt-4 max-w-xl leading-relaxed text-muted-fg">{t("home.edition.tryIt")}</p>
						<p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-fg">
							{t("home.edition.private")}
						</p>
					</div>
					<EditionPreview marks={marks} />
				</section>

				<section aria-labelledby="how" className="mt-20 border-t border-border pt-14">
					<p className={eyebrow}>{t("home.steps.eyebrow")}</p>
					<h2 id="how" className={`mt-3 ${sectionTitle}`}>
						{t("home.steps.title")}
					</h2>
					<ol className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
						{steps.map((key, i) => (
							<li key={key}>
								<span className="font-display text-3xl text-muted-fg" aria-hidden>
									{i + 1}
								</span>
								<h3 className="mt-1 font-medium">{t(`home.steps.${key}.title`)}</h3>
								<p className="mt-1.5 text-sm leading-relaxed text-muted-fg">
									{t(`home.steps.${key}.description`)}
								</p>
							</li>
						))}
					</ol>
					<ul className="mt-10 grid gap-x-10 gap-y-6 border-t border-border pt-8 sm:grid-cols-2 lg:grid-cols-4">
						{extras.map((key) => (
							<li key={key}>
								<h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-medium">
									{t(`home.steps.${key}.title`)}
									{badges[key] ? (
										<span className="shrink-0 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted-fg">
											{t(badges[key])}
										</span>
									) : null}
								</h3>
								<p className="mt-1.5 text-sm leading-relaxed text-muted-fg">
									{t(`home.steps.${key}.description`)}
								</p>
							</li>
						))}
					</ul>
				</section>

				<section
					aria-labelledby="commitments"
					className="mt-20 rounded-2xl bg-muted px-6 py-10 sm:px-10 sm:py-12"
				>
					<p className={eyebrow}>{t("home.commitments.eyebrow")}</p>
					<h2 id="commitments" className={`mt-3 ${sectionTitle}`}>
						{t("home.commitments.title")}
					</h2>
					<p className="mt-5 max-w-2xl leading-relaxed text-muted-fg">
						{t("home.commitments.intro")}
					</p>
					<ul className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
						{commitments.map((key) => (
							<li key={key}>
								<h3 className="font-medium">{t(`home.commitments.${key}.title`)}</h3>
								<p className="mt-1.5 text-sm leading-relaxed text-muted-fg">
									{t(`home.commitments.${key}.description`)}
								</p>
							</li>
						))}
					</ul>
					<Link
						to="/privacy"
						className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-4 hover:underline"
					>
						{t("home.commitments.privacy")}
						<ArrowRight className="size-3.5" aria-hidden />
					</Link>
				</section>

				<section
					aria-labelledby="questions"
					className="mt-20 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-14"
				>
					<div>
						<p className={eyebrow}>{t("home.faq.eyebrow")}</p>
						<h2 id="questions" className={`mt-3 ${sectionTitle}`}>
							{t("home.faq.title")}
						</h2>
					</div>
					<div className="divide-y divide-border border-y border-border">
						{questions.map((key) => (
							<details key={key} className="group py-4">
								<summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
									{t(`home.faq.${key}.question`)}
									<span
										aria-hidden
										className="text-xl leading-none text-muted-fg transition-transform group-open:rotate-45"
									>
										+
									</span>
								</summary>
								<p className="mt-3 max-w-2xl leading-relaxed text-muted-fg">
									{t(`home.faq.${key}.answer`)}
								</p>
							</details>
						))}
					</div>
				</section>

				{loggedIn ? null : (
					<section
						id="invite"
						aria-labelledby="invite-title"
						className="mt-20 grid gap-8 border-t border-border pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14"
					>
						<div>
							{invite ? <p className={eyebrow}>{t("home.invite.eyebrow")}</p> : null}
							<h2 id="invite-title" className={`mt-3 ${sectionTitle}`}>
								{t(invite ? "home.invite.title" : "home.invite.signupTitle")}
							</h2>
							<p className="mt-5 max-w-xl leading-relaxed text-muted-fg">
								{t(invite ? "home.invite.description" : "home.invite.signupDescription")}
							</p>
						</div>
						{invite ? (
							<div>
								<InviteForm token={invite.token} noteMax={invite.noteMax} full />
								<p className="mt-4 text-sm text-muted-fg">{t("home.invite.privacy")}</p>
							</div>
						) : (
							<div className="lg:pt-6">
								<Link to="/signup" className={buttonVariants({ size: "lg" })}>
									{t("home.signup")}
									<ArrowRight className="size-4" aria-hidden />
								</Link>
							</div>
						)}
					</section>
				)}
			</main>
		</PublicPage>
	)
}
