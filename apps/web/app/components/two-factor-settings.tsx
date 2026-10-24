import { Check, Copy, Download } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import type { action } from "~/routes/settings.two-factor"
import { SignInAgain } from "./settings-page"
import { Button, buttonVariants } from "./ui/button"
import { Field } from "./ui/field"

type Answer = Awaited<ReturnType<typeof action>>
type Result = { result: string } & Record<string, unknown>
const resultOf = (data: unknown) => (data as Result | undefined)?.result

/**
 * Settings → Account → Two-factor authentication, a page of its own. Off: the password, then the
 * app's QR code and its first code, then the backup codes. On: new backup codes, or turning it
 * off. The backup codes come after the code that turns it on, on a step of their own that only
 * "Done" leaves: a password manager that fills the code (and sends the form) can't hide them.
 */
export function TwoFactorSettings({
	enabled,
	hasPassword,
	verified,
	email,
}: {
	enabled: boolean
	hasPassword: boolean
	verified: boolean
	email: string
}) {
	const { t } = useTranslation("settings")
	// Not keyed: their answers last as long as this page, and none outlives a later step.
	const start = useFetcher<typeof action>()
	const confirm = useFetcher<typeof action>()
	const disable = useFetcher<typeof action>()
	const renew = useFetcher<typeof action>()
	// On: which of its two changes is open; one form at a time, both asking the same proof.
	const [open, setOpen] = useState<"backup-codes" | "disable" | null>(null)
	// A setup the reader left (Cancel) stays left, though its answer stays on the fetcher.
	const [cancelled, setCancelled] = useState<unknown>(null)
	const started = start.data as Answer | undefined
	const setup =
		started && "result" in started && started.result === "started" && started !== cancelled
			? started
			: null
	// "Done" leaves the page, so these answers never outlive their step.
	const codes =
		resultOf(confirm.data) === "enabled" && setup
			? { codes: setup.backupCodes, fresh: true }
			: resultOf(renew.data) === "new-codes"
				? { codes: (renew.data as Result).backupCodes as string[], fresh: false }
				: null

	if (codes) return <BackupCodes codes={codes.codes} fresh={codes.fresh} />

	if (enabled)
		return (
			<>
				<p className="text-sm" role="status">
					{t("twoFactor.on")}
				</p>
				{open === "backup-codes" ? (
					<CodeForm
						fetcher={renew}
						intent="backup-codes"
						title={t("twoFactor.newCodesTitle")}
						submit={t("twoFactor.newCodes")}
						hasPassword={hasPassword}
						email={email}
						onCancel={() => setOpen(null)}
					/>
				) : open === "disable" ? (
					<CodeForm
						fetcher={disable}
						intent="disable"
						title={t("twoFactor.turnOffTitle")}
						submit={t("twoFactor.turnOff")}
						hasPassword={hasPassword}
						email={email}
						onCancel={() => setOpen(null)}
					/>
				) : (
					<ul className="mt-2 divide-y divide-border text-sm">
						<Choice
							title={t("twoFactor.newCodesTitle")}
							hint={t("twoFactor.newCodesHint")}
							open={t("twoFactor.newCodesOpen")}
							onOpen={() => setOpen("backup-codes")}
						/>
						<Choice
							title={t("twoFactor.turnOffTitle")}
							hint={t("twoFactor.turnOffRowHint")}
							open={t("twoFactor.turnOffOpen")}
							onOpen={() => setOpen("disable")}
						/>
					</ul>
				)}
			</>
		)

	if (setup)
		return (
			<div className="flex flex-col gap-6 text-sm">
				<div>
					<h2 className="font-medium">{t("twoFactor.scan")}</h2>
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
				<confirm.Form method="post" action="/settings/two-factor" className="flex flex-col gap-3">
					<input type="hidden" name="intent" value="confirm" />
					<h2 className="font-medium">{t("twoFactor.confirmTitle")}</h2>
					<div className="sm:w-72">
						<CodeField
							error={resultOf(confirm.data) === "wrong-code" ? t("twoFactor.wrongCode") : undefined}
						/>
					</div>
					<div className="flex gap-3">
						<Button type="submit" size="sm" disabled={confirm.state !== "idle"}>
							{t("twoFactor.confirm")}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => setCancelled(start.data)}
						>
							{t("twoFactor.cancel")}
						</Button>
					</div>
					<Failure result={resultOf(confirm.data)} />
				</confirm.Form>
			</div>
		)

	const startResult = resultOf(start.data)
	return (
		<>
			<start.Form
				method="post"
				action="/settings/two-factor"
				className="flex flex-col gap-3 text-sm"
			>
				<input type="hidden" name="intent" value="start" />
				{resultOf(disable.data) === "disabled" ? (
					<p role="status">{t("twoFactor.disabled")}</p>
				) : null}
				<p className="text-muted-fg">{t("twoFactor.description")}</p>
				{verified ? null : <p>{t("twoFactor.verifyFirst")}</p>}
				{hasPassword ? (
					<>
						<Username email={email} />
						<div className="sm:w-72">
							<Field
								label={t("twoFactor.password")}
								name="password"
								type="password"
								autoComplete="current-password"
								required
								disabled={!verified}
								error={startResult === "wrong-password" ? t("twoFactor.wrongPassword") : undefined}
							/>
						</div>
					</>
				) : null}
				<div>
					<Button type="submit" size="sm" disabled={!verified || start.state !== "idle"}>
						{t("twoFactor.start")}
					</Button>
				</div>
				<Failure result={startResult} />
			</start.Form>
			{/* A form of its own, so outside the one above. */}
			{startResult === "reauthentication-required" ? <SignInAgain hasPassword={false} /> : null}
		</>
	)
}

/** On: one of its changes, a line with the button that opens its form. */
function Choice({
	title,
	hint,
	open,
	onOpen,
}: {
	title: string
	hint: string
	open: string
	onOpen: () => void
}) {
	return (
		<li className="flex items-center justify-between gap-4 py-4">
			<div className="min-w-0">
				<p className="font-medium">{title}</p>
				<p className="mt-0.5 text-muted-fg">{hint}</p>
			</div>
			<Button size="sm" variant="secondary" className="shrink-0" onClick={onOpen}>
				{open}
			</Button>
		</li>
	)
}

/** On: the proof (the password, when there is one, and a code) for one change. */
function CodeForm({
	fetcher,
	intent,
	title,
	submit,
	hasPassword,
	email,
	onCancel,
}: {
	fetcher: ReturnType<typeof useFetcher<typeof action>>
	intent: "disable" | "backup-codes"
	title: string
	submit: string
	hasPassword: boolean
	email: string
	onCancel: () => void
}) {
	const { t } = useTranslation("settings")
	const result = resultOf(fetcher.data)
	return (
		<fetcher.Form
			method="post"
			action="/settings/two-factor"
			aria-label={title}
			className="mt-5 flex flex-col gap-3 border-t border-border pt-5 text-sm"
		>
			<input type="hidden" name="intent" value={intent} />
			<h2 className="font-medium">{title}</h2>
			<p className="-mt-2 text-muted-fg">
				{t(hasPassword ? "twoFactor.proofHint" : "twoFactor.proofHintNoPassword")}
			</p>
			<div className="flex flex-col gap-3 sm:w-72">
				{hasPassword ? (
					<>
						<Username email={email} />
						<Field
							label={t("twoFactor.password")}
							name="password"
							type="password"
							autoComplete="current-password"
							required
							autoFocus
							error={result === "wrong-password" ? t("twoFactor.wrongPassword") : undefined}
						/>
					</>
				) : null}
				<CodeField
					autoFocus={!hasPassword}
					error={result === "wrong-code" ? t("twoFactor.wrongCode") : undefined}
				/>
			</div>
			<div className="flex gap-3">
				<Button
					type="submit"
					size="sm"
					variant={intent === "disable" ? "danger" : "primary"}
					disabled={fetcher.state !== "idle"}
				>
					{submit}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
					{t("twoFactor.cancel")}
				</Button>
			</div>
			<Failure result={result} />
		</fetcher.Form>
	)
}

/** The codes, once: copy, download, and "Done" only after saying they are saved. */
function BackupCodes({ codes, fresh }: { codes: string[]; fresh: boolean }) {
	const { t } = useTranslation("settings")
	const [saved, setSaved] = useState(false)
	const [copied, setCopied] = useState(false)
	const text = `${codes.join("\n")}\n`
	return (
		<div className="flex flex-col gap-4 text-sm">
			{fresh ? (
				<p role="status" className="font-medium">
					{t("twoFactor.enabled")}
				</p>
			) : null}
			<div>
				<h2 className="font-medium">{t("twoFactor.backupTitle")}</h2>
				<p className="mt-1 text-muted-fg">{t("twoFactor.backupHint")}</p>
			</div>
			<ul
				className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-border p-4 font-mono sm:w-80"
				data-testid="two-factor-backup-codes"
			>
				{codes.map((code) => (
					<li key={code}>{code}</li>
				))}
			</ul>
			<div className="flex flex-wrap gap-3">
				<Button
					size="sm"
					variant="secondary"
					onClick={() => {
						void navigator.clipboard?.writeText(text).then(() => setCopied(true))
					}}
				>
					{copied ? (
						<Check className="size-4" aria-hidden />
					) : (
						<Copy className="size-4" aria-hidden />
					)}
					{t(copied ? "twoFactor.copied" : "twoFactor.copy")}
				</Button>
				<a
					href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
					download="klipstack-backup-codes.txt"
					className={buttonVariants({ variant: "secondary", size: "sm" })}
				>
					<Download className="size-4" aria-hidden />
					{t("twoFactor.download")}
				</a>
			</div>
			<label className="flex items-center gap-2">
				<input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
				{t("twoFactor.savedThem")}
			</label>
			<div>
				{saved ? (
					<Link to="/settings/account" className={buttonVariants({ size: "sm" })}>
						{t("twoFactor.done")}
					</Link>
				) : (
					<Button size="sm" disabled>
						{t("twoFactor.done")}
					</Button>
				)}
			</div>
		</div>
	)
}

/**
 * The account a password field belongs to, for password managers: without one they take the
 * nearest text field (the code) for the username, and fill the email there.
 */
function Username({ email }: { email: string }) {
	return (
		<input hidden type="email" name="username" autoComplete="username" value={email} readOnly />
	)
}

function CodeField({ error, autoFocus }: { error?: string; autoFocus?: boolean }) {
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
			autoFocus={autoFocus}
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
