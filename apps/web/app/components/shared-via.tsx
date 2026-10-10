import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"

export interface SharedViaPost {
	id: string
	url: string
	author: string | null
	siteName: string | null
	/** Sanitized when it was extracted. */
	html: string
	/** Formatted in the loader, like the article's date. */
	published: string | null
	restorable: boolean
}

/**
 * A post kept because the page it shares refused Klipstack: where to go, and how the two meet.
 */
export function SharedLinkBlocked({ url }: { url: string }) {
	const { t } = useTranslation("reader")
	return (
		<p
			data-testid="shared-link-blocked"
			className="mt-6 rounded-lg border border-border/70 bg-fg/[0.03] px-4 py-3 text-sm text-muted-fg"
		>
			{t("via.blocked")}{" "}
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				className="text-fg underline underline-offset-2"
			>
				{t("via.openLink")}
			</a>
		</p>
	)
}

/**
 * The posts an article was saved through, above it: who shared it and what they said, a link to the
 * post, and a way back to reading the post itself.
 */
export function SharedVia({ documentId, posts }: { documentId: string; posts: SharedViaPost[] }) {
	const { t } = useTranslation("reader")
	const fetcher = useFetcher()
	if (posts.length === 0) return null
	const busy = fetcher.state !== "idle"
	return (
		<div className="mt-6 space-y-3" data-testid="shared-via">
			{posts.map((post) => (
				<aside
					key={post.id}
					aria-label={t("via.label")}
					className="rounded-lg border border-border/70 bg-fg/[0.03] px-4 py-3 text-sm"
				>
					<p className="text-xs text-muted-fg">
						{post.author ? t("via.sharedBy", { author: post.author }) : t("via.sharedAnonymously")}
						{post.siteName ? ` · ${post.siteName}` : null}
						{post.published ? ` · ${post.published}` : null}
					</p>
					<div
						className="mt-1.5 text-fg [&_a]:text-link [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:mt-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_p+p]:mt-2"
						// oxlint-disable-next-line react/no-danger -- sanitized at extraction, as the article is
						dangerouslySetInnerHTML={{ __html: post.html }}
					/>
					<p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
						<a
							href={post.url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-muted-fg underline-offset-2 hover:text-fg hover:underline"
						>
							{t("via.open")}
						</a>
						{post.restorable ? (
							<button
								type="button"
								disabled={busy}
								onClick={() =>
									fetcher.submit(
										{ intent: "read-post" },
										{ method: "post", action: `/documents/${documentId}/state` },
									)
								}
								className="text-muted-fg underline-offset-2 hover:text-fg hover:underline disabled:opacity-60"
							>
								{busy ? t("via.switching") : t("via.readPost")}
							</button>
						) : null}
					</p>
				</aside>
			))}
		</div>
	)
}
