import { CheckCircle2, Mail } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useFetcher, useSearchParams } from "react-router"
import { VERIFY_EMAIL_MINUTES } from "~/lib/auth-constants"
import type { action } from "~/routes/settings.verify-email"
import { Button } from "./ui/button"

export function EmailVerification({
	email,
	verified,
	emailEnabled,
}: {
	email: string
	verified: boolean
	emailEnabled: boolean
}) {
	const { t } = useTranslation("auth")
	const fetcher = useFetcher<typeof action>({ key: "email-verification" })
	const [params] = useSearchParams()
	const result = fetcher.data?.result
	const sent = result === "sent"
	const busy = fetcher.state !== "idle"

	if (verified)
		return (
			<p className="flex items-center gap-2 text-sm" data-testid="email-verified">
				<CheckCircle2 className="size-4 text-accent" aria-hidden />
				{t("verification.verified")}
			</p>
		)

	return (
		<section aria-label={t("verification.title")} className="text-sm">
			<p className="flex items-center gap-2 font-medium">
				<Mail className="size-4 shrink-0 text-accent" aria-hidden />
				{t("verification.title")}
			</p>
			<p className="mt-1 break-words text-muted-fg">{t("verification.description", { email })}</p>
			<p className="mt-1 text-muted-fg">{t("verification.instructions")}</p>
			{emailEnabled ? (
				<fetcher.Form method="post" action="/settings/verify-email" className="mt-3">
					<Button type="submit" size="sm" variant="secondary" disabled={busy}>
						{t(busy ? "verification.sending" : sent ? "verification.resend" : "verification.send")}
					</Button>
				</fetcher.Form>
			) : (
				<p className="mt-2">{t("verification.unavailable")}</p>
			)}
			{sent ? (
				<p className="mt-2" role="status">
					{t("verification.sent", { email, minutes: VERIFY_EMAIL_MINUTES })}
				</p>
			) : null}
			{result === "failed" || result === "unavailable" || result === "limited" ? (
				<p className="mt-2 text-danger" role="alert">
					{t(`verification.${result}`, {
						minutes: fetcher.data && "minutes" in fetcher.data ? fetcher.data.minutes : 15,
					})}
				</p>
			) : params.has("error") && !sent ? (
				<p className="mt-2 text-danger" role="alert">
					{t(
						params.get("error") === "wrong-account"
							? "verification.wrongAccount"
							: "verification.expired",
					)}
				</p>
			) : null}
		</section>
	)
}
