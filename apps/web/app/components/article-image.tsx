import type { CSSProperties } from "react"
import { siteHue } from "~/lib/book-hue"
import { cn } from "~/lib/utils"

/**
 * An article's lead image, or a cover of the same size when it has none: cards in a row line up
 * whether or not their articles have images. The library's cards and Home's use it.
 */
export function ArticleImage({
	src,
	cover,
	eager = false,
	className,
}: {
	src: string | null
	/**
	 * What its cover says without an image: the site, and the title when the cover has room. Its
	 * paint is the site's books' on the shelves: `shelf` is what they are told apart by.
	 */
	cover: { site: string; title: string; shelf: string }
	eager?: boolean
	className?: string
}) {
	return (
		<div className={cn("@container overflow-hidden bg-fg/5", className)}>
			{src ? (
				<img
					src={src}
					alt=""
					loading={eager ? "eager" : "lazy"}
					referrerPolicy="no-referrer"
					className="h-full w-full object-cover"
				/>
			) : (
				<Cover {...cover} />
			)}
		</div>
	)
}

/**
 * A book's cover, in the paint of its site's books on the shelves (`--k-book-*`): the site on top,
 * the title set in the logo's serif below. A small one has room for the site's initial only. The
 * card beside it says both, so the cover is hidden from screen readers, and its words are drawn by
 * CSS: not text of the page, the title is found once when searched for.
 */
function Cover({ site, title, shelf }: { site: string; title: string; shelf: string }) {
	return (
		<div
			data-testid="article-image-placeholder"
			aria-hidden
			style={{ "--hue": siteHue(shelf) } as CSSProperties}
			className="flex h-full w-full flex-col justify-between gap-[3cqw] bg-[oklch(var(--k-book-l)_var(--k-book-c)_var(--hue))] p-[7cqw] text-book-fg"
		>
			<p
				data-site={site}
				className="truncate text-[max(0.625rem,4cqw)] leading-tight font-medium tracking-[0.12em] uppercase opacity-75 before:content-[attr(data-site)]"
			/>
			<p
				data-initial={(Array.from(site)[0] ?? "").toUpperCase()}
				className="font-display text-[42cqw] leading-[0.8] font-medium before:content-[attr(data-initial)] @min-[12rem]:hidden"
			/>
			<p
				data-title={title}
				className="line-clamp-4 hidden border-t wrap-anywhere border-current/25 pt-[3cqw] font-display text-[7.5cqw] leading-[1.1] font-medium text-balance before:content-[attr(data-title)] @min-[12rem]:block"
			/>
		</div>
	)
}
