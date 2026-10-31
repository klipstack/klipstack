import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { shortTitle } from "~/lib/home-shelves"

/** Titles longer than this are cut, so the sentence stays one line or two. */
const FINISHED_TITLE_MAX = 80
const TITLE_SLOT = "\u0000title\u0000"

/**
 * What the reader finished in the past week, the masthead's line under the greeting. Only what was read: nothing about
 * what is left, no comparison, and nothing at all after a week without a finish. A link beside it
 * leads to the Your reading page.
 */
export function FinishedLately({ count, title }: { count: number; title: string | null }) {
	const { t } = useTranslation("library")
	let text: ReactNode
	if (count > 1) text = t("home.finished.count", { count })
	else if (!title) text = t("home.finished.untitled")
	else {
		// The sentence around the title, which is set apart as one. Not markup in the string: a title
		// may hold anything.
		const [before, after] = t("home.finished.named", { title: TITLE_SLOT }).split(TITLE_SLOT)
		text = (
			<>
				{before}
				<cite className="text-fg not-italic">{shortTitle(title, FINISHED_TITLE_MAX)}</cite>
				{after}
			</>
		)
	}
	return (
		<p className="font-display text-lg text-pretty text-muted-fg italic">
			<span data-testid="home-finished">{text}</span>{" "}
			{/* Beside the sentence, not around it: a title in it reads as the article's, not a link. */}
			<Link
				to="/reading"
				className="font-sans text-sm whitespace-nowrap not-italic underline decoration-border underline-offset-4 hover:decoration-current"
			>
				{t("home.finished.more")}
			</Link>
		</p>
	)
}
