import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { cn } from "~/lib/utils"
import type { StarterItem } from "~/services/starter-texts.server"
import { Button, buttonVariants } from "./ui/button"

/**
 * Texts to start with (`lib/starter-texts.server.ts`): the guide and public-domain essays, each
 * added with one click (the Add page's action), or opened when the reader has it already. In the
 * reader's language first; a heading per language when there are both.
 */
export function StarterTexts({
	items,
	language,
	title,
	className,
}: {
	items: StarterItem[]
	language: string
	/** The section's heading, when not the default. */
	title?: string
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
				<div key={lang} className="mt-5">
					{languages.length > 1 ? (
						<h3 className="mb-1 text-xs font-medium tracking-wide text-muted-fg uppercase">
							{t(`starter.language.${lang}`)}
						</h3>
					) : null}
					<ul className="divide-y divide-border">
						{items
							.filter((item) => item.language === lang)
							.map((item) => (
								<StarterRow key={item.slug} item={item} foreign={lang !== language} />
							))}
					</ul>
				</div>
			))}
		</section>
	)
}

function StarterRow({ item, foreign }: { item: StarterItem; foreign: boolean }) {
	const { t } = useTranslation("library")
	const navigation = useNavigation()
	const adding = navigation.formData?.get("starter") === item.slug
	const byline = [item.author, t("starter.minutes", { count: item.minutes })]
		.filter(Boolean)
		.join(" · ")
	return (
		<li className="flex items-center gap-4 py-3">
			<div className="min-w-0 flex-1" lang={foreign ? item.language : undefined}>
				<p className="font-serif text-lg leading-snug">{item.title}</p>
				<p className="mt-0.5 text-sm text-muted-fg">{byline}</p>
			</div>
			{item.articleId ? (
				<span className="flex items-center gap-1 text-sm text-muted-fg">
					{t("starter.saved")}
					<Link
						to={`/read/${item.articleId}`}
						className={buttonVariants({ variant: "ghost", size: "sm" })}
						aria-label={t("starter.openLabel", { title: item.title })}
					>
						{t("starter.open")}
					</Link>
				</span>
			) : (
				<Form method="post" action="/add">
					<input type="hidden" name="starter" value={item.slug} />
					<Button
						type="submit"
						variant="secondary"
						size="sm"
						disabled={navigation.state !== "idle"}
						aria-label={t("starter.addLabel", { title: item.title })}
					>
						{adding ? t("starter.adding") : t("starter.add")}
					</Button>
				</Form>
			)}
		</li>
	)
}
