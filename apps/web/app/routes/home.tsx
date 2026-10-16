import { ArrowRight } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link } from "react-router"
import { ChooseDemo } from "~/components/landing/choose-demo"
import { FinishDemo, type FinishState } from "~/components/landing/finish-demo"
import { HighlightDemo } from "~/components/landing/highlight-demo"
import { InviteForm } from "~/components/landing/invite-form"
import { KeepDemo } from "~/components/landing/keep-demo"
import { PhonePreview } from "~/components/landing/phone-preview"
import { INITIAL_MARKS, type Marks, type SentenceId } from "~/components/landing/sample"
import { PostIt } from "~/components/post-it"
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
		title: `${t("appName")} · ${plain(t("home.headline"))}`,
		description: plain(t("home.description")),
		url: `${env.APP_URL}/`,
		card: {
			...shareCard(i18n.language),
			alt: t("home.shareCard.alt", { appName: t("appName"), headline: plain(t("home.headline")) }),
		},
	}
}

/** A string without its markup, for the page's title and description. */
function plain(text: string) {
	return text.replace(/<[^>]+>/g, "")
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
		{ property: "og:image:alt", content: card.alt },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:image:alt", content: card.alt },
	]
}

const REPO_URL = "https://github.com/klipstack/klipstack"
const SELF_HOSTING_URL = `${REPO_URL}/tree/main/docs/self-hosting`

/** The walkthrough's steps, in the order a reader meets them; each is a section of the page. */
const journey = [
	{ key: "choose", id: "choose" },
	{ key: "read", id: "read" },
	{ key: "capture", id: "capture" },
	{ key: "keep", id: "keep" },
] as const
const basics = ["save", "read", "find"] as const
const phoneFeatures = ["save", "listen", "widget"] as const
const commitments = ["private", "ads", "export", "delete", "copy", "source"] as const
const questions = [
	"free",
	"invite",
	"note",
	"notes",
	"quotes",
	"import",
	"apps",
	"extension",
	"search",
	"ai",
	"privacy",
] as const

const eyebrow = "text-xs font-semibold tracking-[0.08em] text-muted-fg uppercase"
const sectionTitle = "font-display text-3xl tracking-tight text-balance sm:text-4xl"
const link =
	"inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-4 hover:underline"

const INITIAL_FINISH: FinishState = {
	note: "",
	editionNote: "",
	starred: false,
	shortlisted: false,
}

export default function Home({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	const { loggedIn, inviteOnly, invite } = loaderData
	// One sample article, followed through every step: what is marked and written in one step shows
	// in the next.
	const [marks, setMarks] = useState<Marks>(INITIAL_MARKS)
	const [finish, setFinish] = useState<FinishState>(INITIAL_FINISH)
	const [quoted, setQuoted] = useState<SentenceId[]>([])
	return (
		<PublicPage loggedIn={loggedIn}>
			<main className="pb-20">
				<section className="pt-4 pb-14 sm:pt-10 lg:pb-20">
					<p className={eyebrow}>
						{t(inviteOnly ? "home.hero.eyebrowInvite" : "home.hero.eyebrow")}
					</p>
					<h1 className="mt-4 max-w-5xl font-display text-[clamp(2.75rem,6.6vw,6rem)] leading-[0.98] font-[620] tracking-[-0.03em] text-balance">
						<Trans
							i18nKey="home.headline"
							components={{ mark: <mark className="marker swipe" /> }}
						/>
					</h1>
					<div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
						<div className="max-w-xl">
							<p className="text-lg leading-relaxed">
								<Trans
									i18nKey="home.description"
									components={{ strong: <strong className="font-semibold" /> }}
								/>
							</p>
							<p className="mt-3 leading-relaxed text-muted-fg">{t("home.hero.private")}</p>
						</div>
						<div className="lg:pt-1">
							{invite ? (
								<>
									<InviteForm token={invite.token} noteMax={invite.noteMax} />
									<p className="mt-3 text-sm text-muted-fg">{t("home.hero.admission")}</p>
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
								</div>
							)}
						</div>
					</div>
					<nav aria-label={t("home.journey.label")} className="mt-14">
						<ol className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
							{journey.map(({ key, id }, i) => (
								<li key={key} className="bg-bg">
									<a
										href={`#${id}`}
										className="group flex h-full items-baseline gap-3 px-5 py-4 hover:bg-hover"
									>
										<span className="font-display text-2xl text-muted-fg" aria-hidden>
											{i + 1}
										</span>
										<span className="font-medium group-hover:underline">
											{t(`home.journey.steps.${key}`)}
										</span>
									</a>
								</li>
							))}
						</ol>
					</nav>
				</section>

				<section aria-labelledby="journey" className="border-t border-border pt-14">
					<p className={eyebrow}>{t("home.journey.eyebrow")}</p>
					<h2 id="journey" className={`mt-3 ${sectionTitle}`}>
						{t("home.journey.title")}
					</h2>
					<p className="mt-5 max-w-2xl leading-relaxed text-muted-fg">
						{t("home.journey.description")}
					</p>

					<Step
						id="choose"
						eyebrowText={t("home.choose.eyebrow")}
						title={t("home.choose.title")}
						demo={<ChooseDemo readHref="#read" />}
					>
						<p>{t("home.choose.body")}</p>
						<p>{t("home.choose.more")}</p>
						<p className="text-sm text-muted-fg">{t("home.choose.source")}</p>
					</Step>

					<Step
						id="read"
						eyebrowText={t("home.read.eyebrow")}
						title={t("home.read.title")}
						demo={
							<HighlightDemo
								marks={marks}
								onChange={(next) => {
									setMarks(next)
									// A highlight removed is out of the edition: marked again, it starts unquoted.
									setQuoted(quoted.filter((id) => next[id]))
								}}
							/>
						}
					>
						<p>{t("home.read.body")}</p>
						<p>{t("home.read.more")}</p>
					</Step>

					<Step
						id="capture"
						eyebrowText={t("home.capture.eyebrow")}
						title={t("home.capture.title")}
						subtitle={t("home.capture.prompt")}
						demo={<FinishDemo state={finish} onChange={setFinish} nextHref="#keep" />}
					>
						<p>{t("home.capture.body")}</p>
						<p>{t("home.capture.optional")}</p>
						<p className="text-muted-fg">{t("home.capture.edition")}</p>
					</Step>

					<Step
						id="keep"
						eyebrowText={t("home.keep.eyebrow")}
						title={t("home.keep.title")}
						demo={
							<KeepDemo
								marks={marks}
								finish={finish}
								quoted={quoted}
								onQuote={setQuoted}
								onShortlist={() => setFinish({ ...finish, shortlisted: true })}
							/>
						}
					>
						<p>{t("home.keep.body")}</p>
						<div className="mt-8 border-t border-border pt-6">
							<p className={eyebrow}>{t("home.keep.edition.eyebrow")}</p>
							<h3 className="mt-2 font-display text-2xl tracking-tight">
								{t("home.keep.edition.title")}
							</h3>
							<p className="mt-3">{t("home.keep.edition.body")}</p>
							<p className="mt-3 text-sm text-muted-fg">{t("home.keep.edition.private")}</p>
						</div>
					</Step>
				</section>

				<section
					id="iphone"
					aria-labelledby="iphone-title"
					className="mt-20 grid items-center gap-12 rounded-2xl bg-muted px-6 py-12 sm:px-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14"
				>
					<div>
						<p className={eyebrow}>{t("home.phone.eyebrow")}</p>
						<h2 id="iphone-title" className={`mt-3 ${sectionTitle}`}>
							{t("home.phone.title")}
						</h2>
						<p className="mt-5 max-w-xl leading-relaxed">{t("home.phone.body")}</p>
						<ul className="mt-8 grid max-w-xl gap-5">
							{phoneFeatures.map((key) => (
								<li key={key}>
									<h3 className="font-medium">{t(`home.phone.${key}.title`)}</h3>
									<p className="mt-1 text-sm leading-relaxed text-muted-fg">
										{t(`home.phone.${key}.description`)}
									</p>
								</li>
							))}
						</ul>
						<p className="mt-8 max-w-xl text-sm leading-relaxed text-muted-fg">
							{t("home.phone.account")}
						</p>
					</div>
					<PhonePreview />
				</section>

				<section aria-labelledby="basics" className="mt-20 border-t border-border pt-14">
					<p className={eyebrow}>{t("home.basics.eyebrow")}</p>
					<h2 id="basics" className={`mt-3 ${sectionTitle}`}>
						{t("home.basics.title")}
					</h2>
					<ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
						{basics.map((key) => (
							<li key={key}>
								<h3 className="font-medium">{t(`home.basics.${key}.title`)}</h3>
								<p className="mt-1.5 text-sm leading-relaxed text-muted-fg">
									{t(`home.basics.${key}.description`)}
								</p>
							</li>
						))}
					</ul>
				</section>

				<section
					aria-labelledby="maker"
					className="mt-20 grid items-center gap-10 border-t border-border pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14"
				>
					<div>
						<p className={eyebrow}>{t("home.maker.eyebrow")}</p>
						<h2 id="maker" className={`mt-3 ${sectionTitle}`}>
							{t("home.maker.title")}
						</h2>
					</div>
					<PostIt tilt={1} className="max-w-xl text-lg leading-relaxed sm:px-8 sm:pt-9 sm:pb-7">
						<p>{t("home.maker.body")}</p>
						<p className="mt-4">{t("home.maker.more")}</p>
						<p className="mt-4 text-right">— {t("home.maker.signature")}</p>
					</PostIt>
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
					<div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
						<Link to="/privacy" className={link}>
							{t("home.commitments.privacy")}
							<ArrowRight className="size-3.5" aria-hidden />
						</Link>
						<a href={REPO_URL} className={link}>
							{t("home.commitments.code")}
							<ArrowRight className="size-3.5" aria-hidden />
						</a>
						<a href={SELF_HOSTING_URL} className={link}>
							{t("home.commitments.selfHost")}
							<ArrowRight className="size-3.5" aria-hidden />
						</a>
					</div>
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
								{t(
									invite
										? "home.invite.description"
										: inviteOnly
											? "home.invite.signupDescription"
											: "home.invite.openDescription",
								)}
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

/** One step of the walkthrough: what it does for the reader, beside the sample that shows it. */
function Step({
	id,
	eyebrowText,
	title,
	subtitle,
	demo,
	children,
}: {
	id: string
	eyebrowText: string
	title: string
	subtitle?: string
	demo: ReactNode
	children: ReactNode
}) {
	return (
		<section
			id={id}
			aria-labelledby={`${id}-title`}
			className="mt-14 grid scroll-mt-6 items-start gap-8 border-t border-border pt-12 lg:mt-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14"
		>
			<div className="lg:sticky lg:top-8">
				<p className={eyebrow}>{eyebrowText}</p>
				<h3 id={`${id}-title`} className={`mt-3 ${sectionTitle}`}>
					{title}
				</h3>
				{subtitle ? (
					<p className="mt-3 font-display text-xl text-muted-fg italic">{subtitle}</p>
				) : null}
				<div className="mt-5 max-w-xl space-y-4 leading-relaxed">{children}</div>
			</div>
			<div className="min-w-0">{demo}</div>
		</section>
	)
}
