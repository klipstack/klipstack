import { Search } from "lucide-react"
import type { ReactNode } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link } from "react-router"
import type { EditionEar, PartOfDay } from "~/lib/home-masthead"
import { HomeGreeting } from "./home-greeting"
import { SaveLinkButton } from "./save-link-dialog"

/**
 * Home as the morning paper's front page: the date and the next edition in the ears, the greeting
 * as the nameplate, then what was finished lately and the reader's choices (`children`) under it,
 * between the rules a newspaper sets its masthead in.
 */
export function HomeMasthead({
	date,
	part,
	edition,
	deck,
	children,
}: {
	/** Today, as `mastheadDate` prints it on the server; null before it knows the reader's zone. */
	date: string | null
	part: PartOfDay | null
	edition: EditionEar
	/** The line under the greeting: what was finished lately, if anything. */
	deck: ReactNode
	children?: ReactNode
}) {
	const { t } = useTranslation("library")
	return (
		<>
			{/* The ears: a row of its own, as tall as other pages' title rows, so it lines up with the
			    sidebar's top row as theirs do. */}
			<div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-fg text-sm text-muted-fg max-md:pb-1.5 md:h-10">
				{date ? <p data-testid="home-date">{date}</p> : <span />}
				<div className="flex items-center gap-2">
					{edition ? <EditionCorner edition={edition} /> : null}
					{/* Phones have both in the top bar. */}
					<div className="hidden items-center gap-1 md:flex">
						<Link
							to="/search"
							state={{ from: "/home" }}
							aria-label={t("search.label")}
							className="rounded-md p-2 text-muted-fg hover:bg-hover hover:text-fg"
						>
							<Search className="size-5" aria-hidden />
						</Link>
						{/* As big as the search button beside it, inside the row's rule. */}
						<SaveLinkButton className="size-9" />
					</div>
				</div>
			</div>
			<header
				data-testid="home-masthead"
				className="mb-8 border-b-[3px] border-double border-fg pt-5 pb-5"
			>
				<div className="space-y-2 md:text-center">
					{/* Phones name the page in the top bar's heading: there, the greeting is a line of text. */}
					<h1 className="page-title hidden text-balance md:block md:text-[3.25rem] md:leading-[1.1]">
						<HomeGreeting part={part} />
					</h1>
					<p data-testid="home-greeting" className="page-title text-balance md:hidden">
						<HomeGreeting part={part} />
					</p>
					{deck}
				</div>
				{children ? <div className="mt-5 space-y-3">{children}</div> : null}
			</header>
		</>
	)
}

/** The next edition, in the masthead's ear: a draft to go on with, or articles marked to start one. */
export function EditionCorner({ edition }: { edition: NonNullable<EditionEar> }) {
	const { t } = useTranslation("library")
	const key = edition.draft
		? edition.count
			? "home.edition.draft"
			: "home.edition.draftEmpty"
		: "home.edition.marked"
	return (
		<p data-testid="home-edition">
			<Trans
				t={t}
				i18nKey={key}
				count={edition.count}
				components={{
					count: <span className="text-fg" />,
					editions: <Link to="/editions" className="text-link hover:underline" />,
				}}
			/>
		</p>
	)
}
