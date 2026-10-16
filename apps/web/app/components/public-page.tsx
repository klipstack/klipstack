import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { copyrightYear, LEGAL_NAME } from "~/lib/company"
import { BrandLogo } from "./brand-mark"

/** The frame of the pages anyone can open: the landing page, the policies and support. */
export function PublicPage({
	loggedIn,
	children,
}: {
	loggedIn: boolean
	children: React.ReactNode
}) {
	const { t } = useTranslation()
	const account = loggedIn
		? { to: "/home", label: t("home.openApp") }
		: { to: "/login", label: t("home.login") }
	return (
		<div className="safe-top mx-auto flex min-h-dvh max-w-6xl flex-col px-6 sm:px-10">
			<header className="flex items-center justify-between gap-4 py-6 sm:py-8">
				<Link to="/" aria-label={t("appName")} className="rounded-md">
					<BrandLogo className="h-8 w-auto sm:h-9" markClassName="text-accent" />
				</Link>
				<Link
					to={account.to}
					className="rounded-lg px-3 py-2 text-sm font-medium text-muted-fg transition-colors hover:bg-hover hover:text-fg"
				>
					{account.label}
				</Link>
			</header>
			{children}
			<footer className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border py-8 text-sm text-muted-fg">
				<span>{t("home.footer.copyright", { year: copyrightYear(), company: LEGAL_NAME })}</span>
				<nav aria-label={t("home.footer.label")} className="flex gap-6">
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
		</div>
	)
}
