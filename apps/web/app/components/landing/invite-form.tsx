import { useId } from "react"
import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { INVITE_TRAP } from "~/lib/invite-form"

/**
 * The landing page's request for an invite. It posts to /request-invite, which answers with its
 * own page: thanks, or the form again with what to fix. `full` adds the optional note.
 */
export function InviteForm({
	token,
	noteMax,
	full = false,
}: {
	token: string
	noteMax: number
	full?: boolean
}) {
	const { t } = useTranslation()
	const { t: ta } = useTranslation("auth")
	const id = useId()
	return (
		<Form method="post" action="/request-invite" className="flex flex-col gap-3">
			<input type="hidden" name="started" value={token} />
			<div className={full ? "flex flex-col gap-1.5" : "flex flex-col gap-2 sm:flex-row"}>
				<Label htmlFor={`${id}-email`} className={full ? undefined : "sr-only"}>
					{t("home.hero.emailLabel")}
				</Label>
				<Input
					id={`${id}-email`}
					name="email"
					type="email"
					autoComplete="email"
					required
					maxLength={254}
					placeholder={full ? undefined : t("home.hero.emailLabel")}
					className="h-11 sm:max-w-xs"
				/>
				{full ? null : (
					<Button type="submit" size="lg">
						{t("home.requestInvite")}
					</Button>
				)}
			</div>
			{full ? (
				<>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${id}-note`}>{ta("requestInvite.note")}</Label>
						<textarea
							id={`${id}-note`}
							name="note"
							rows={3}
							maxLength={noteMax}
							className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg shadow-xs placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<Button type="submit" size="lg" className="self-start">
						{t("home.requestInvite")}
					</Button>
				</>
			) : null}
			{/* Off screen and out of the tab order; hidden from screen readers too. */}
			<div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
				<label>
					{ta("requestInvite.trap")}
					<input type="text" name={INVITE_TRAP} tabIndex={-1} autoComplete="off" defaultValue="" />
				</label>
			</div>
		</Form>
	)
}
