import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { copyrightYear, LEGAL_NAME } from "~/lib/company"
import { BrandLogo } from "./brand-mark"

/**
 * `appQuery`: the signed request of the app's sign-in the page is part of. The brand is not a link
 * there: the web's home page would leave the sign-in, and offer what the app's sign-in leaves out.
 * The policy links carry the request, so their pages lead back into the sign-in.
 */
export function AuthCard({
	title,
	appQuery = null,
	children,
}: {
	title: string
	appQuery?: string | null
	children: React.ReactNode
}) {
	const { t } = useTranslation()
	const inApp = appQuery !== null
	const q = inApp ? `?${appQuery}` : ""
	const brand = <BrandLogo className="h-8 w-auto sm:h-9" markClassName="text-accent" />
	const brandClass = "mb-4 flex md:mb-8"
	return (
		// Tighter on phones, where sign-in and consent often run in an app's small browser sheet.
		<main className="safe-top flex min-h-dvh flex-col items-center px-4 pt-6 pb-8 md:justify-center md:py-12">
			{inApp ? (
				<div className={brandClass}>{brand}</div>
			) : (
				<Link to="/" className={brandClass}>
					{brand}
				</Link>
			)}
			<section className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
				<h1 className="mb-4 text-xl font-semibold md:mb-6">{title}</h1>
				{children}
			</section>
			<footer className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-fg">
				<span>{t("home.footer.copyright", { year: copyrightYear(), company: LEGAL_NAME })}</span>
				<nav aria-label={t("home.footer.label")} className="flex gap-4">
					<Link to={`/terms${q}`} className="hover:text-fg">
						{t("home.footer.terms")}
					</Link>
					<Link to={`/privacy${q}`} className="hover:text-fg">
						{t("home.footer.privacy")}
					</Link>
					<Link to={`/support${q}`} className="hover:text-fg">
						{t("home.footer.support")}
					</Link>
				</nav>
			</footer>
		</main>
	)
}
