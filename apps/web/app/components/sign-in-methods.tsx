import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useSearchParams } from "react-router"
import { MIN_PASSWORD_LENGTH } from "~/lib/auth-constants"
import type { action } from "~/routes/settings.sign-in"
import { PROVIDER_NAMES, type ProviderId, ProviderMark } from "./provider-buttons"
import { Button } from "./ui/button"
import { Field } from "./ui/field"

const CONNECT_ERRORS: Record<string, "emailMismatch" | "linkedElsewhere"> = {
	"email_doesn't_match": "emailMismatch",
	account_already_linked_to_different_user: "linkedElsewhere",
}

/** Settings → Account: the password and the providers that open this account. */
export function SignInMethods({
	hasPassword,
	linked,
	providers,
	verified,
	emailEnabled,
}: {
	hasPassword: boolean
	linked: readonly string[]
	providers: readonly ProviderId[]
	verified: boolean
	emailEnabled: boolean
}) {
	const { t } = useTranslation("settings")
	const password = useFetcher<typeof action>({ key: "sign-in-password" })
	const provider = useFetcher<typeof action>({ key: "sign-in-provider" })
	const [params] = useSearchParams()
	const form = useRef<HTMLFormElement>(null)
	const passwordResult = password.data?.result
	const saved = passwordResult === "password-set" || passwordResult === "password-changed"

	useEffect(() => {
		if (saved) form.current?.reset()
	}, [saved])

	// A linked provider whose credentials left the environment can still be disconnected.
	const shown = [
		...providers,
		...linked.filter(
			(id): id is ProviderId => id in PROVIDER_NAMES && !providers.includes(id as ProviderId),
		),
	]
	const connectError = params.get("connect") === "failed" ? (params.get("error") ?? "") : null

	return (
		<section aria-label={t("signIn.title")} className="mt-6 border-t border-border pt-4 text-sm">
			<h3 className="font-medium">{t("signIn.title")}</h3>
			<p className="mt-1 text-muted-fg">
				{t(emailEnabled ? "signIn.descriptionWithLinks" : "signIn.description")}
			</p>
			{verified ? null : <p className="mt-2 text-muted-fg">{t("signIn.verifyFirst")}</p>}

			<password.Form
				ref={form}
				method="post"
				action="/settings/sign-in"
				className="mt-4 flex flex-col gap-3"
			>
				<input type="hidden" name="intent" value="password" />
				{hasPassword ? (
					<Field
						label={t("signIn.currentPassword")}
						name="currentPassword"
						type="password"
						autoComplete="current-password"
						required
						error={passwordResult === "wrong-password" ? t("signIn.wrongPassword") : undefined}
					/>
				) : null}
				<Field
					label={t("signIn.newPassword")}
					name="newPassword"
					type="password"
					autoComplete="new-password"
					required
					minLength={MIN_PASSWORD_LENGTH}
					disabled={!verified}
					hint={hasPassword ? t("signIn.changeHint") : t("signIn.setHint")}
					error={
						passwordResult === "bad-length"
							? t("signIn.badLength", { min: MIN_PASSWORD_LENGTH })
							: undefined
					}
				/>
				<div>
					<Button
						type="submit"
						size="sm"
						variant="secondary"
						disabled={!verified || password.state !== "idle"}
					>
						{t(hasPassword ? "signIn.changePassword" : "signIn.setPassword")}
					</Button>
				</div>
				{saved ? (
					<p role="status">{t("signIn.passwordSaved")}</p>
				) : passwordResult === "limited" || passwordResult === "failed" ? (
					<p className="text-danger" role="alert">
						{t(`signIn.${passwordResult}`)}
					</p>
				) : null}
			</password.Form>

			{shown.length > 0 ? (
				<ul className="mt-4 flex flex-col gap-2">
					{shown.map((id) => {
						const isLinked = linked.includes(id)
						return (
							<li key={id} className="flex items-center justify-between gap-3">
								<span className="flex items-center gap-2">
									<ProviderMark provider={id} />
									{PROVIDER_NAMES[id]}
									{isLinked ? (
										<span className="text-muted-fg" data-testid={`linked-${id}`}>
											{t("signIn.connected")}
										</span>
									) : null}
								</span>
								<provider.Form method="post" action="/settings/sign-in">
									<input type="hidden" name="intent" value={isLinked ? "unlink" : "link"} />
									<input type="hidden" name="provider" value={id} />
									<Button
										type="submit"
										size="sm"
										variant="secondary"
										disabled={(!isLinked && !verified) || provider.state !== "idle"}
										aria-label={t(isLinked ? "signIn.disconnectNamed" : "signIn.connectNamed", {
											provider: PROVIDER_NAMES[id],
										})}
									>
										{t(isLinked ? "signIn.disconnect" : "signIn.connect")}
									</Button>
								</provider.Form>
							</li>
						)
					})}
				</ul>
			) : null}
			{provider.data?.result === "last-method" ? (
				<p className="mt-2 text-danger" role="alert">
					{t("signIn.lastMethod")}
				</p>
			) : connectError !== null && provider.state === "idle" && !provider.data ? (
				<p className="mt-2 text-danger" role="alert">
					{t(`signIn.errors.${CONNECT_ERRORS[connectError] ?? "failed"}`)}
				</p>
			) : null}
		</section>
	)
}
