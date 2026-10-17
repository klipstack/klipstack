import { Mail } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { SUPPYHQ_ORIGIN, type SupportWidgetConfig } from "~/lib/support-widget"
import { tooltip } from "./tooltip-host"

/** The page's theme: the account's choice on `<html>`, or the system's. */
function pageTheme(): "light" | "dark" {
	const chosen = document.documentElement.dataset.theme
	if (chosen === "light" || chosen === "dark") return chosen
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

/**
 * The support button, and SuppyHQ's panel it opens. The panel shows Ernesto's face; the button is
 * the app's own, since SuppyHQ's face button would show it there too. SuppyHQ's script draws the
 * panel on `<body>`, outside React, once per sign-in: navigating keeps it, and what someone typed.
 * The styles in `app.css` show both only on pages whose layout asks for it
 * (`SupportWidgetHandle`), from tablet width, so they never cover the phone's bottom sheets.
 */
export function SupportWidget({ tenant, email, name }: SupportWidgetConfig) {
	const { t } = useTranslation()
	const label = t("supportWidget.label")
	const headline = t("supportWidget.greeting")
	const successTitle = t("supportWidget.acknowledgment")
	const successMessage = t("supportWidget.expectation")

	useEffect(() => {
		const script = document.createElement("script")
		script.src = `${SUPPYHQ_ORIGIN}/w.js`
		const attributes = {
			"data-suppyhq-tenant": tenant,
			"data-suppyhq-user-email": email,
			"data-suppyhq-user-name": name,
			"data-suppyhq-position": "right",
			"data-suppyhq-avatar-mode": "face",
			"data-suppyhq-launcher": "hidden",
			"data-suppyhq-label": label,
			"data-suppyhq-headline": headline,
			"data-suppyhq-success-title": successTitle,
			"data-suppyhq-success-message": successMessage,
			"data-theme": pageTheme(),
		}
		for (const [key, value] of Object.entries(attributes)) script.setAttribute(key, value)
		document.body.append(script)

		// The widget follows its tag's data-theme, also after it loads.
		const syncTheme = () => script.setAttribute("data-theme", pageTheme())
		const scheme = matchMedia("(prefers-color-scheme: dark)")
		scheme.addEventListener("change", syncTheme)
		const observer = new MutationObserver(syncTheme)
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		})

		// Signing out, another account, or a new language: the next widget starts fresh.
		return () => {
			scheme.removeEventListener("change", syncTheme)
			observer.disconnect()
			script.remove()
			document.querySelector("[data-suppyhq-host]")?.remove()
		}
	}, [tenant, email, name, label, headline, successTitle, successMessage])

	const open = t("supportWidget.open")
	return (
		<button
			type="button"
			aria-label={open}
			{...tooltip(open)}
			onClick={() => window.dispatchEvent(new Event("suppyhq:open"))}
			className="support-launcher fixed right-6 bottom-6 z-30 size-12 items-center justify-center rounded-full border border-border bg-card text-muted-fg shadow-lg hover:bg-hover hover:text-fg"
		>
			<Mail className="size-5" aria-hidden />
		</button>
	)
}
