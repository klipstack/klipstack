import { creditAuthor, safeHost, siteLabel } from "~/lib/site-label"

/**
 * Who wrote a shared highlight's article and where, on one line: "Jane Doe · The Guardian". The site
 * is cut first: who wrote it matters more than where.
 */
export function CreditLine({
	article,
	className = "",
}: {
	article: { title: string | null; url: string; siteName: string | null; author?: string | null }
	className?: string
}) {
	const site = siteLabel(article.siteName, safeHost(article.url))
	const author = creditAuthor(article)
	return (
		<span className={`flex min-w-0 ${className}`}>
			{author ? (
				<>
					<span className="max-w-[75%] shrink-0 truncate">{author}</span>
					<span className="shrink-0 whitespace-pre"> · </span>
				</>
			) : null}
			<span className="min-w-0 truncate">{site}</span>
		</span>
	)
}
