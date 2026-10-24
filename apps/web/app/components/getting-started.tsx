import { Check, ListChecks, X } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Form, Link, useFetcher, useNavigate } from "react-router"
import { cn } from "~/lib/utils"
import { openSaveLink, saveLinkPath } from "./save-link-dialog"
import { tooltip } from "./tooltip-host"

/** The sidebar's Getting started card, from the layout loader (`gettingStarted`). */
export type GettingStartedNav = {
	steps: {
		save: boolean
		/** Null: not offered here (another browser, a phone, or a server the extension doesn't save to). */
		extension: boolean | null
		highlight: boolean
		feature: boolean
		topics: boolean
	}
	/** The extension page, which offers each browser its store. */
	extensionUrl: string
	/** The guide's slug, in the reader's language: the place to try a highlight. */
	guide: string
} | null

/**
 * A new account's first steps, in the sidebar: save an article, save one with the extension,
 * highlight a passage, turn a feature on. Each ticks itself from what the reader does; an open
 * step leads to where it is done. The ✕ ends it for good; with every step done it says so, once.
 * In the rail: an icon with the count, which opens the sidebar.
 */
export function GettingStarted({
	card,
	collapsed,
	onExpand,
	onNavigate,
}: {
	card: GettingStartedNav
	collapsed: boolean
	onExpand?: () => void
	onNavigate?: () => void
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher()
	const navigate = useNavigate()
	const end = () =>
		void fetcher.submit({ intent: "end-card" }, { method: "post", action: "/onboarding" })
	const steps = card?.steps
	const offered = steps
		? ([
				["save", steps.save],
				...(steps.extension === null ? [] : [["extension", steps.extension] as const]),
				["highlight", steps.highlight],
				["feature", steps.feature],
			] as const)
		: []
	const done = offered.filter(([, isDone]) => isDone).length
	const finished = offered.length > 0 && done === offered.length
	// Every step done: "All set" shows, and the card is over. It stays on screen until the page is
	// left for good (the loader has none from then on), or its ✕.
	const [allSet, setAllSet] = useState(false)
	const ended = useRef(false)
	useEffect(() => {
		if (!finished || ended.current) return
		ended.current = true
		setAllSet(true)
		end()
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- once, when every step is done
	}, [finished])
	const [hidden, setHidden] = useState(false)
	if (hidden || (!card && !allSet)) return null

	const total = offered.length
	if (collapsed) {
		if (allSet) return null
		const label = t("gettingStarted.rail", { done, total })
		return (
			<button
				type="button"
				onClick={onExpand}
				data-testid="getting-started"
				aria-label={label}
				{...tooltip(label, undefined, "right")}
				className="relative mx-auto my-3 flex size-9 items-center justify-center rounded-lg border border-dashed border-accent/50 text-accent hover:bg-accent/10"
			>
				<ListChecks className="size-4" aria-hidden />
				<span className="absolute -top-1.5 -right-1.5 rounded-full bg-accent px-1 text-[10px] leading-4 font-medium text-accent-fg tabular-nums">
					{t("gettingStarted.badge", { done, total })}
				</span>
			</button>
		)
	}

	const dismiss = (
		<button
			type="button"
			onClick={() => {
				setHidden(true)
				if (!allSet) end()
			}}
			aria-label={t("gettingStarted.dismiss")}
			{...tooltip(t("gettingStarted.dismiss"))}
			className="-mr-1 rounded-md p-1 text-muted-fg hover:bg-hover hover:text-fg"
		>
			<X className="size-3.5" aria-hidden />
		</button>
	)

	if (allSet)
		return (
			<section data-testid="getting-started" className="pt-4 pb-3" aria-live="polite">
				<div className="rounded-lg border border-dashed border-accent/50 bg-accent/5 p-2.5 text-sm">
					<div className="flex items-center gap-2">
						<Check className="size-4 text-accent" aria-hidden />
						<h2 className="flex-1 font-medium">{t("gettingStarted.allSet")}</h2>
						{dismiss}
					</div>
					<p className="mt-1 text-xs text-muted-fg">{t("gettingStarted.allSetText")}</p>
				</div>
			</section>
		)

	const labelId = "getting-started-title"
	const row = (key: (typeof offered)[number][0], isDone: boolean, children: ReactNode) => (
		<li key={key} className="flex items-start gap-2 py-1">
			{/* The box says the step's state to a screen reader, as its own word: no text is joined. */}
			<span
				role="img"
				aria-label={isDone ? t("gettingStarted.done") : t("gettingStarted.toDo")}
				className={cn(
					"mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[4px]",
					isDone ? "bg-accent text-accent-fg" : "ring-1 ring-muted-fg ring-inset",
				)}
			>
				{isDone ? <Check aria-hidden className="size-2.5" strokeWidth={3} /> : null}
			</span>
			<span className={cn("min-w-0", isDone && "text-muted-fg line-through")}>{children}</span>
		</li>
	)
	// An open step leads where it is done; the extension page opens in a new tab, so it looks like a link out.
	const stepLink = "text-left text-fg underline-offset-2 hover:underline"
	const outLink = "text-accent underline underline-offset-2 hover:decoration-2"
	const label = (key: "save" | "extension" | "highlight" | "feature") =>
		key === "feature" && !steps!.topics
			? t("gettingStarted.steps.featureNoTopics")
			: t(`gettingStarted.steps.${key}`)
	return (
		<section data-testid="getting-started" aria-labelledby={labelId} className="pt-4 pb-3">
			<div className="rounded-lg border border-dashed border-accent/50 bg-accent/5 p-2.5 text-sm">
				<div className="flex items-center gap-2">
					<ListChecks className="size-4 text-accent" aria-hidden />
					<h2 id={labelId} className="flex-1 font-medium">
						{t("gettingStarted.title")}
					</h2>
					{dismiss}
				</div>
				<div className="mt-1.5 mb-1 flex items-center gap-2">
					<div
						role="progressbar"
						aria-labelledby={labelId}
						aria-valuemin={0}
						aria-valuemax={total}
						aria-valuenow={done}
						className="h-[3px] flex-1 overflow-hidden rounded-full bg-border"
					>
						<div
							className="h-full bg-accent transition-[width]"
							style={{ width: `${(done / total) * 100}%` }}
						/>
					</div>
					<span className="text-xs text-muted-fg tabular-nums">
						{t("gettingStarted.progress", { done, total })}
					</span>
				</div>
				<ul className="text-xs">
					{offered.map(([key, isDone]) => {
						if (isDone)
							return row(
								key,
								true,
								key === "extension" ? (
									<Trans
										t={t}
										i18nKey="gettingStarted.steps.extension"
										components={{ store: <span /> }}
									/>
								) : (
									label(key)
								),
							)
						switch (key) {
							case "save":
								return row(
									key,
									false,
									<button
										type="button"
										className={stepLink}
										onClick={() => {
											onNavigate?.()
											if (!openSaveLink()) void navigate(saveLinkPath())
										}}
									>
										{label(key)}
									</button>,
								)
							case "extension":
								return row(
									key,
									false,
									<Trans
										t={t}
										i18nKey="gettingStarted.steps.extension"
										components={{
											store: (
												// oxlint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- Trans fills it
												<a
													href={card!.extensionUrl}
													target="_blank"
													rel="noopener noreferrer"
													className={outLink}
												/>
											),
										}}
									/>,
								)
							case "highlight":
								// The guide asks for a highlight: it opens, added to the library if need be.
								return row(
									key,
									false,
									<Form method="post" action="/texts" className="inline" onSubmit={onNavigate}>
										<input type="hidden" name="starter" value={card!.guide} />
										<button type="submit" className={stepLink}>
											{label(key)}
										</button>
									</Form>,
								)
							default:
								return row(
									key,
									false,
									<Link to="/settings/features" onClick={onNavigate} className={stepLink}>
										{label(key)}
									</Link>,
								)
						}
					})}
				</ul>
			</div>
		</section>
	)
}
