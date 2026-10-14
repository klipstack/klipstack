import { ArrowDown } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { REDISCOVER_AFTER_DAYS, TIME_CHOICES } from "~/lib/inbox-filters"
import { cn } from "~/lib/utils"
import { type SampleSave, sampleShelves } from "./sample"

/** The choices the sample offers: Home's, but the hour, which the sample has nothing to fill. */
const CHOICES = TIME_CHOICES.filter((m) => m < 60)

/**
 * The walkthrough's Home: "How much time do you have?" over a small sample library, sorted by
 * Home's own rules. The sample essay links on to the reader below (`readHref`).
 * Plain markup rather than a screenshot, so it follows the theme and the language.
 */
export function ChooseDemo({ readHref }: { readHref: string }) {
	const { t } = useTranslation()
	const { t: tl } = useTranslation("library")
	const [minutes, setMinutes] = useState<number | null>(15)
	const { reading, pickUp, recent, rediscover } = sampleShelves(minutes)
	const chip = (active: boolean) =>
		cn(
			"rounded-full border px-3 py-1 text-sm transition-colors",
			active ? "marked" : "border-border text-fg hover:bg-muted",
		)

	const row = (save: SampleSave) => {
		const essay = save.id === "essay"
		return (
			<li
				key={save.id}
				data-save={save.id}
				className={cn(
					"flex items-center gap-3 rounded-xl px-3 py-2.5",
					essay ? "bg-muted ring-1 ring-border" : null,
				)}
			>
				<div className="min-w-0 flex-1">
					<p className="truncate text-xs text-muted-fg">{t(`home.choose.items.${save.id}.site`)}</p>
					<p className="mt-0.5 font-display text-[1.05rem] leading-snug">
						{t(`home.choose.items.${save.id}.title`)}
					</p>
					{save.progress > 0 ? (
						<div className="mt-2 flex items-center gap-2">
							<span className="h-1 w-24 overflow-hidden rounded-full bg-border">
								<span
									className="block h-full bg-accent"
									style={{ width: `${save.progress * 100}%` }}
								/>
							</span>
							<span className="text-xs text-muted-fg">
								{tl("continueReading.left", { count: save.minutesLeft })}
							</span>
						</div>
					) : (
						<p className="mt-1 text-xs text-muted-fg">
							{tl("home.time.choice", { count: save.minutesLeft })}
						</p>
					)}
				</div>
				{essay ? (
					<a
						href={readHref}
						className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
					>
						{t("home.choose.readIt")}
						<ArrowDown className="size-3.5" aria-hidden />
					</a>
				) : null}
			</li>
		)
	}
	const shelf = (title: string, saves: SampleSave[], note?: string) =>
		saves.length === 0 ? null : (
			<section className="mt-5">
				<h4 className="px-3 text-sm font-medium">{title}</h4>
				{note ? <p className="mt-1 px-3 text-xs text-muted-fg">{note}</p> : null}
				<ul className="mt-1.5 grid gap-1">{saves.map(row)}</ul>
			</section>
		)

	return (
		<figure
			aria-label={t("home.choose.demoLabel")}
			className="rounded-2xl border border-border bg-card px-3 pt-5 pb-4 shadow-sm sm:px-5"
		>
			<fieldset className="flex flex-wrap items-center gap-2 px-3">
				<legend className="float-left mr-1 text-sm text-muted-fg">{tl("home.time.title")}</legend>
				<button
					type="button"
					aria-pressed={minutes === null}
					onClick={() => setMinutes(null)}
					className={chip(minutes === null)}
				>
					{tl("home.time.any")}
				</button>
				{CHOICES.map((m) => (
					<button
						key={m}
						type="button"
						aria-pressed={minutes === m}
						onClick={() => setMinutes(m)}
						className={chip(minutes === m)}
					>
						{tl("home.time.choice", { count: m })}
					</button>
				))}
			</fieldset>
			<div>
				{shelf(
					tl("continueReading.title"),
					reading,
					pickUp && minutes !== null ? tl("home.time.pickUp", { count: minutes }) : undefined,
				)}
				{shelf(tl("home.recent"), recent)}
				{shelf(
					tl("home.rediscover.title"),
					rediscover,
					tl("home.rediscover.description", { count: REDISCOVER_AFTER_DAYS }),
				)}
			</div>
		</figure>
	)
}
