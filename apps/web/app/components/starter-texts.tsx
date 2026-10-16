import { Bookmark, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { buttonVariants } from "~/components/ui/button"
import { hash } from "~/lib/book-hue"
import { cn } from "~/lib/utils"
import type { StarterItem } from "~/services/starter-texts.server"

/**
 * Texts to start with (`lib/starter-texts.server.ts`) as books on a shelf. A book faces out, cover
 * first, colored as the books on /topics are: one the reader has is marked with a ribbon and opens
 * their copy; the others are added with one click (the Add page's action) and open. The guide is
 * not one of the books: it has a card of its own (`StarterGuide`).
 */
export function StarterShelf({
	items,
	language,
	label,
	wide = false,
	className,
}: {
	items: StarterItem[]
	/** The reader's language: a book in another is marked as such for screen readers. */
	language: string
	/** The shelf's name, for screen readers. */
	label: string
	/** A page of its own: bigger books, each with a line about it. */
	wide?: boolean
	className?: string
}) {
	return (
		// The books stand on the shelf's board; past the width, the shelf scrolls, fading out on the
		// side that has more.
		<div className={cn("border-b-[7px] border-shelf", className)}>
			<ul
				aria-label={label}
				className="shelf-fade flex snap-x scroll-px-3 items-end gap-3 overflow-x-auto overflow-y-hidden px-3 pt-3 [scrollbar-width:none]"
			>
				{items.map((item) => (
					<StarterBook
						key={item.slug}
						item={item}
						foreign={item.language !== language}
						wide={wide}
					/>
				))}
			</ul>
		</div>
	)
}

/**
 * What a page with nothing to read offers (Home, the empty library): the guide, while the reader
 * doesn't have it, a few texts from different topics, and the way to the rest.
 */
export function StarterOffer({
	offer,
	language,
	className,
}: {
	offer: { guide: StarterItem | null; texts: StarterItem[] }
	language: string
	className?: string
}) {
	const { t } = useTranslation("library")
	if (!offer.guide && !offer.texts.length) return null
	return (
		<section aria-labelledby="starter-title" className={cn("text-left text-fg", className)}>
			<h2 id="starter-title" className="font-serif text-2xl">
				{t("starter.homeTitle")}
			</h2>
			{offer.guide ? <StarterGuide item={offer.guide} className="mt-4" /> : null}
			{offer.texts.length ? (
				<>
					<p className="mt-4 text-sm leading-relaxed text-muted-fg">{t("starter.description")}</p>
					<StarterShelf
						items={offer.texts}
						language={language}
						label={t("starter.shelf")}
						className="mt-2"
					/>
				</>
			) : null}
			<Link
				to="/texts"
				className="mt-4 inline-block text-sm text-link underline-offset-4 hover:underline"
			>
				{t("starter.more")}
			</Link>
		</section>
	)
}

/**
 * The guide to Klipstack, as a card rather than a book among the essays: a short line on what it
 * is, and the button that adds it, or opens the reader's copy.
 */
export function StarterGuide({ item, className }: { item: StarterItem; className?: string }) {
	const { t } = useTranslation("library")
	const navigation = useNavigation()
	const adding = navigation.formData?.get("starter") === item.slug
	return (
		<div
			data-testid="starter-guide"
			className={cn(
				"flex items-center gap-4 rounded-xl border border-border bg-muted/50 p-3 pr-4",
				adding && "animate-pulse",
				className,
			)}
		>
			{/* The house's own book, in its colors. */}
			<span
				aria-hidden
				className="flex h-16 w-12 shrink-0 items-end rounded-l-[2px] rounded-r bg-accent p-1.5 text-[9px] leading-tight text-accent-fg shadow-[inset_3px_0_0_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.12)]"
			>
				Klipstack
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium text-muted-fg">
					{t(item.articleId ? "starter.saved" : "starter.guide.eyebrow")}
				</p>
				<h3 className="font-serif text-lg leading-snug">{item.title}</h3>
				<p className="text-sm leading-snug text-muted-fg">
					{t("starter.guide.description", { count: item.minutes })}
				</p>
			</div>
			{item.articleId ? (
				<Link
					to={`/read/${item.articleId}`}
					className={buttonVariants({ variant: "secondary", size: "sm" })}
					aria-label={t("starter.openLabel", { title: item.title })}
				>
					<Bookmark aria-hidden className="size-4 fill-favorite text-favorite" />
					{t("starter.openSaved")}
				</Link>
			) : (
				<Form method="post" action="/texts">
					<input type="hidden" name="starter" value={item.slug} />
					<button
						type="submit"
						className={buttonVariants({ size: "sm" })}
						disabled={navigation.state !== "idle"}
						aria-label={t("starter.addLabel", { title: item.title })}
					>
						<Plus aria-hidden className="size-4" />
						{t("starter.read")}
					</button>
				</Form>
			)}
		</div>
	)
}

function StarterBook({
	item,
	foreign,
	wide,
}: {
	item: StarterItem
	foreign: boolean
	wide: boolean
}) {
	const { t } = useTranslation("library")
	const navigation = useNavigation()
	const adding = navigation.formData?.get("starter") === item.slug
	const style = {
		"--h": hash(item.slug) % 14,
		"--hue": (hash(item.slug) % 12) * 30,
	} as React.CSSProperties
	const cover = cn(
		"relative flex flex-col rounded-l-[3px] rounded-r-md p-3 pl-4 text-left motion-safe:transition-transform hover:-translate-y-1 focus-visible:-translate-y-1",
		wide
			? "h-[calc(208px+var(--h)*1px)] w-40 sm:h-[calc(232px+var(--h)*1px)] sm:w-44"
			: "h-[calc(150px+var(--h)*1px)] w-[7.5rem] sm:h-[calc(166px+var(--h)*1px)] sm:w-32",
		// The spine's fold down the left edge, and the cover's own shadow.
		"shadow-[inset_5px_0_0_rgb(0_0_0/0.08),inset_6px_0_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.12)]",
		"bg-[oklch(var(--k-book-l)_var(--k-book-c)_var(--hue))] text-book-fg",
		adding && "animate-pulse",
	)
	const face = (
		<span lang={foreign ? item.language : undefined} className="contents">
			<span
				className={cn(
					"line-clamp-5 font-serif leading-snug hyphens-auto [overflow-wrap:anywhere]",
					wide ? "text-base sm:text-lg" : "text-sm sm:text-base",
				)}
			>
				{item.title}
			</span>
			{wide && item.description ? (
				<span className="mt-2 line-clamp-4 text-xs leading-snug opacity-75">
					{item.description}
				</span>
			) : null}
			<span className="mt-auto pt-2 pr-7 text-[11px] leading-tight opacity-80">
				{item.author}
				<span className="block opacity-80">{t("starter.minutes", { count: item.minutes })}</span>
			</span>
		</span>
	)
	return (
		<li className="flex shrink-0 snap-start" style={style}>
			{item.articleId ? (
				<Link
					to={`/read/${item.articleId}`}
					className={cover}
					aria-label={t("starter.openLabel", { title: item.title })}
					title={t("starter.saved")}
				>
					{face}
					{/* A ribbon: this one is in the library. */}
					<Bookmark
						aria-hidden
						className="absolute -top-0.5 right-2 size-5 fill-favorite text-favorite"
					/>
				</Link>
			) : (
				<Form method="post" action="/texts" className="flex">
					<input type="hidden" name="starter" value={item.slug} />
					<button
						type="submit"
						className={cn(cover, "group")}
						disabled={navigation.state !== "idle"}
						aria-label={t("starter.addLabel", { title: item.title })}
						title={t("starter.add")}
					>
						{face}
						<span
							aria-hidden
							className="absolute right-2 bottom-2 flex size-6 items-center justify-center rounded-full bg-bg/85 text-fg shadow-sm group-hover:bg-bg"
						>
							<Plus className="size-4" />
						</span>
					</button>
				</Form>
			)}
		</li>
	)
}
