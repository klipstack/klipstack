import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { copyrightYear, LEGAL_NAME } from "~/lib/company"
import { BrandMark } from "./brand-mark"

/**
 * `inApp`: the page is part of an app's sign-in. The brand is not a link there: the web's home page
 * would leave the sign-in, and offer what the app's sign-in leaves out.
 */
export function AuthCard({
	title,
	inApp = false,
	children,
}: {
	title: string
	inApp?: boolean
	children: React.ReactNode
}) {
	const { t } = useTranslation()
	const brand = (
		<>
			<BrandMark className="h-9 w-auto text-accent md:h-11" />
			{t("appName")}
		</>
	)
	const brandClass =
		"mb-4 flex items-center gap-3 text-xl font-semibold tracking-tight md:mb-8 md:text-2xl"
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
					<Link to="/terms" className="hover:text-fg">
						{t("home.footer.terms")}
					</Link>
					<Link to="/privacy" className="hover:text-fg">
						{t("home.footer.privacy")}
					</Link>
					<Link to="/support" className="hover:text-fg">
						{t("home.footer.support")}
					</Link>
				</nav>
			</footer>
		</main>
	)
}
