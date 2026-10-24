import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import type { action } from "~/routes/settings.two-factor"
import { SignInAgain } from "./settings-page"
import { Button } from "./ui/button"
import { Field } from "./ui/field"

/** Settings → Account: the authenticator app that every new sign-in asks a code of. */
export function TwoFactorSettings({
	enabled,
	hasPassword,
	verified,
}: {
	enabled: boolean
	hasPassword: boolean
	verified: boolean
}) {
	const { t } = useTranslation("settings")
	const start = useFetcher<typeof action>({ key: "two-factor-start" })
	const confirm = useFetcher<typeof action>({ key: "two-factor-confirm" })
	const disable = useFetcher<typeof action>({ key: "two-factor-disable" })
	const setup = start.data?.result === "started" ? start.data : null
	const confirmed = confirm.data?.result
	const turnedOff = disable.data?.result === "disabled"

	return (
		<section aria-label={t("twoFactor.title")} className="mt-6 border-t border-border pt-4 text-sm">
			<h3 className="font-medium">{t("twoFactor.title")}</h3>
			<p className="mt-1 text-muted-fg">{t("twoFactor.description")}</p>

			{enabled ? (
				<>
					<p className="mt-3" role="status">
						{confirmed === "enabled" ? t("twoFactor.enabled") : t("twoFactor.on")}
					</p>
					<disable.Form
						method="post"
						action="/settings/two-factor"
						className="mt-3 flex flex-col gap-3"
					>
						<input type="hidden" name="intent" value="disable" />
						<p className="text-muted-fg">{t("twoFactor.turnOffHint")}</p>
						<div className="flex flex-col gap-3">
							{hasPassword ? (
								<Field
									label={t("twoFactor.password")}
									name="password"
									type="password"
									autoComplete="current-password"
									required
									error={
										disable.data?.result === "wrong-password"
											? t("twoFactor.wrongPassword")
											: undefined
									}
								/>
							) : null}
							<div className="sm:w-72">
								<CodeField
									error={
										disable.data?.result === "wrong-code" ? t("twoFactor.wrongCode") : undefined
									}
								/>
							</div>
						</div>
						<div>
							<Button
								type="submit"
								size="sm"
								variant="secondary"
								disabled={disable.state !== "idle"}
							>
								{t("twoFactor.turnOff")}
							</Button>
						</div>
						<Failure result={disable.data?.result} />
					</disable.Form>
				</>
			) : setup ? (
				<div className="mt-4 flex flex-col gap-5">
					<div>
						<p className="font-medium">{t("twoFactor.scan")}</p>
						<img
							src={setup.qr}
							alt={t("twoFactor.qrAlt")}
							width={176}
							height={176}
							className="mt-3 rounded-lg border border-border bg-white"
						/>
						<p className="mt-3 text-muted-fg">{t("twoFactor.manual")}</p>
						<code className="mt-1 block break-all font-mono" data-testid="two-factor-key">
							{setup.secret.replace(/(.{4})/g, "$1 ").trim()}
						</code>
					</div>
					<div>
						<p className="font-medium">{t("twoFactor.backupTitle")}</p>
						<p className="mt-1 text-muted-fg">{t("twoFactor.backupHint")}</p>
						<ul
							className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono sm:w-72"
							data-testid="two-factor-backup-codes"
						>
							{setup.backupCodes.map((code) => (
								<li key={code}>{code}</li>
							))}
						</ul>
					</div>
					<confirm.Form method="post" action="/settings/two-factor" className="flex flex-col gap-3">
						<input type="hidden" name="intent" value="confirm" />
						<p className="font-medium">{t("twoFactor.confirmTitle")}</p>
						<div className="sm:w-72">
							<CodeField
								error={confirmed === "wrong-code" ? t("twoFactor.wrongCode") : undefined}
							/>
						</div>
						<div>
							<Button type="submit" size="sm" disabled={confirm.state !== "idle"}>
								{t("twoFactor.confirm")}
							</Button>
						</div>
						<Failure result={confirmed} />
					</confirm.Form>
				</div>
			) : (
				<start.Form
					method="post"
					action="/settings/two-factor"
					className="mt-3 flex flex-col gap-3"
				>
					<input type="hidden" name="intent" value="start" />
					{turnedOff ? <p role="status">{t("twoFactor.disabled")}</p> : null}
					{verified ? null : <p className="text-muted-fg">{t("twoFactor.verifyFirst")}</p>}
					{hasPassword ? (
						<Field
							label={t("twoFactor.password")}
							name="password"
							type="password"
							autoComplete="current-password"
							required
							disabled={!verified}
							error={
								start.data?.result === "wrong-password" ? t("twoFactor.wrongPassword") : undefined
							}
						/>
					) : null}
					<div>
						<Button
							type="submit"
							size="sm"
							variant="secondary"
							disabled={!verified || start.state !== "idle"}
						>
							{t("twoFactor.start")}
						</Button>
					</div>
					<Failure result={start.data?.result} />
					{start.data?.result === "reauthentication-required" ? (
						<SignInAgain hasPassword={false} />
					) : null}
				</start.Form>
			)}
		</section>
	)
}

function CodeField({ error }: { error?: string }) {
	const { t } = useTranslation("settings")
	return (
		<Field
			label={t("twoFactor.code")}
			name="code"
			autoComplete="one-time-code"
			autoCapitalize="off"
			spellCheck={false}
			required
			maxLength={20}
			error={error}
		/>
	)
}

/** The refusals that belong to no field. */
function Failure({ result }: { result: string | undefined }) {
	const { t } = useTranslation("settings")
	if (result !== "limited" && result !== "expired") return null
	return (
		<p className="text-danger" role="alert">
			{t(`twoFactor.${result}`)}
		</p>
	)
}
