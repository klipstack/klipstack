import { Newspaper } from "lucide-react"
import { cn } from "~/lib/utils"

/**
 * An article's lead image, or a placeholder of the same size when it has none: cards in a row line
 * up whether or not their articles have images. The library's cards and Home's use it.
 */
export function ArticleImage({
	src,
	eager = false,
	className,
}: {
	src: string | null
	eager?: boolean
	className?: string
}) {
	return (
		<div className={cn("overflow-hidden bg-fg/5", className)}>
			{src ? (
				<img
					src={src}
					alt=""
					loading={eager ? "eager" : "lazy"}
					referrerPolicy="no-referrer"
					className="h-full w-full object-cover"
				/>
			) : (
				<div
					data-testid="article-image-placeholder"
					className="flex h-full w-full items-center justify-center text-muted-fg/50"
				>
					<Newspaper className="size-7" aria-hidden />
				</div>
			)}
		</div>
	)
}
