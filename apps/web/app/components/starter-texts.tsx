import { Bookmark, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { hash } from "~/lib/book-hue"
import { cn } from "~/lib/utils"
import type { StarterItem } from "~/services/starter-texts.server"

/**
 * Texts to start with (`lib/starter-texts.server.ts`) as books on a shelf, one shelf per language,
 * the reader's first. A book faces out, cover first, colored as the books on /topics are: one the
 * reader has is marked with a ribbon and opens their copy; the others are added with one click
 * (the Add page's action) and open.
 */
export function StarterTexts({
	items,
	language,
	title,
	wide = false,
	className,
}: {
	items: StarterItem[]
	language: string
	/** The section's heading, when not the default. */
	title?: string
	/** A page of its own: bigger books, each with a line about it. */
	wide?: boolean
	className?: string
}) {
	const { t } = useTranslation("library")
	if (!items.length) return null
	const languages = [...new Set(items.map((item) => item.language))]
	return (
		<section aria-labelledby="starter-title" className={cn("text-left", className)}>
			<h2 id="starter-title" className="font-serif text-2xl">
				{title ?? t("starter.title")}
			</h2>
			<p className="mt-1 text-sm leading-relaxed text-muted-fg">{t("starter.description")}</p>
			{languages.map((lang) => (
				<Shelf
					key={lang}
					wide={wide}
					label={languages.length > 1 ? t(`starter.language.${lang}`) : null}
					items={items.filter((item) => item.language === lang)}
					foreign={lang !== language}
				/>
			))}
		</section>
	)
}

function Shelf({
	label,
	items,
	foreign,
	wide,
}: {
	label: string | null
	items: StarterItem[]
	foreign: boolean
	wide: boolean
}) {
	const { t } = useTranslation("library")
	return (
		<div className="mt-6">
			{label ? (
				<h3 className="mb-2 text-xs font-medium tracking-wide text-muted-fg uppercase">{label}</h3>
			) : null}
			{/* The books stand on the shelf's board; past the width, the shelf scrolls, fading out on
			    the side that has more. */}
			<div className="border-b-[7px] border-shelf">
				<ul
					aria-label={label ?? t("starter.shelf")}
					className="shelf-fade flex snap-x scroll-px-3 items-end gap-3 overflow-x-auto overflow-y-hidden px-3 pt-3 [scrollbar-width:none]"
				>
					{items.map((item) => (
						<StarterBook key={item.slug} item={item} foreign={foreign} wide={wide} />
					))}
				</ul>
			</div>
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
	const guide = item.kind === "guide"
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
		// The guide is the house's own book, in its colors.
		guide
			? "bg-accent text-accent-fg"
			: "bg-[oklch(var(--k-book-l)_var(--k-book-c)_var(--hue))] text-book-fg",
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
				<Form method="post" action="/add" className="flex">
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
