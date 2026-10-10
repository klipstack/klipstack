import { useTranslation } from "react-i18next"
import { cn } from "~/lib/utils"
import { editionQuotes, HL_SOLID_BORDER, type Marks, NOTED, QUOTE_MAX } from "./sample"

/**
 * A public edition built from what the visitor highlighted in the hero: each highlight is a quote,
 * in article order, until the quote limit. The ones past it show as left out, as the edition
 * editor refuses them.
 */
export function EditionPreview({ marks }: { marks: Marks }) {
	const { t } = useTranslation()
	const { quotes, used } = editionQuotes(marks, (id) => t(`home.demo.sentences.${id}`))

	return (
		<figure
			aria-label={t("home.edition.previewLabel")}
			className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
		>
			<div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2.5">
				<span aria-hidden className="flex gap-1.5">
					<span className="size-2.5 rounded-full bg-border" />
					<span className="size-2.5 rounded-full bg-border" />
					<span className="size-2.5 rounded-full bg-border" />
				</span>
				<span className="truncate font-mono text-xs text-muted-fg">
					klipstack.com/e/7fQ2kLm9xA1c/week-40-2026
				</span>
			</div>
			<div className="px-5 py-6 sm:px-8 sm:py-8">
				<p className="text-xs font-medium tracking-wide text-muted-fg uppercase">
					{t("home.edition.kicker")}
				</p>
				<p className="mt-1 font-display text-3xl tracking-tight">{t("home.edition.name")}</p>
				<p className="mt-3 font-display text-lg text-muted-fg italic">{t("home.edition.intro")}</p>

				<div className="mt-6 border-t border-border pt-5">
					<p className="font-display text-xl leading-snug text-link">{t("home.demo.title")}</p>
					<p className="mt-1 text-xs text-muted-fg">{t("home.demo.site")}</p>
					{quotes.length === 0 ? (
						<p className="mt-4 text-sm text-muted-fg">{t("home.edition.empty")}</p>
					) : (
						<ul className="mt-4 space-y-3">
							{quotes.map((quote) => (
								<li key={quote.id} className={cn(!quote.fits && "opacity-50")}>
									<blockquote
										className={cn(
											"border-l-[3px] pl-3 font-display text-[1.02rem] leading-relaxed",
											HL_SOLID_BORDER,
											!quote.fits && "line-through decoration-muted-fg",
										)}
									>
										{quote.text}
									</blockquote>
									{!quote.fits ? (
										<p className="mt-1 pl-3.5 text-xs text-muted-fg">{t("home.edition.over")}</p>
									) : quote.id === NOTED ? (
										<p className="mt-1.5 pl-3.5 text-sm text-muted-fg">
											{t("home.demo.marginNote")}
										</p>
									) : null}
								</li>
							))}
						</ul>
					)}
				</div>
				<p
					className={cn(
						"mt-6 text-xs tabular-nums",
						quotes.some((quote) => !quote.fits) ? "text-fg" : "text-muted-fg",
					)}
					aria-live="polite"
				>
					{t("home.edition.counter", { count: used, max: QUOTE_MAX })}
				</p>
			</div>
		</figure>
	)
}
