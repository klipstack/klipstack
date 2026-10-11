import { useId } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, Link, useNavigation } from "react-router"
import { z } from "zod"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { Label } from "~/components/ui/label"
import { authLimitResponse } from "~/lib/auth-limits.server"
import { env } from "~/lib/env.server"
import { type FieldErrors, parseForm } from "~/lib/forms"
import { useIsNsKey, useKeyTranslation } from "~/lib/i18n-keys"
import { getInstance, getLocale } from "~/lib/i18n.server"
import { INVITE_TRAP as TRAP } from "~/lib/invite-form"
import {
	formToken,
	INVITE_REQUEST_NOTE_MAX,
	type InviteRequestOutcome,
	requestInvite,
} from "~/lib/invite-requests.server"
import { readForm } from "~/lib/request-body.server"
import { requireAnonymous } from "~/lib/session.server"
import { cn } from "~/lib/utils"
import type { Route } from "./+types/request-invite"

const schema = z.object({
	email: z.email("auth:validation.emailInvalid").max(254, "auth:validation.emailInvalid"),
	note: z.string().max(INVITE_REQUEST_NOTE_MAX, "auth:requestInvite.noteTooLong").optional(),
})

// Its own title, not one of the root's: those reach every page's data, admin denials included.
export function meta({ loaderData }: Route.MetaArgs) {
	return [{ title: loaderData ? `${loaderData.title} · Klipstack` : "Klipstack" }]
}

/** Only in `SIGNUP_MODE=waitlist`: elsewhere the page does not exist. */
function requireWaitlist() {
	if (env.SIGNUP_MODE !== "waitlist") throw data(null, { status: 404 })
}

export async function loader({ context }: Route.LoaderArgs) {
	requireAnonymous(context)
	requireWaitlist()
	return {
		title: getInstance(context).t("auth:requestInvite.title"),
		token: formToken(),
		noteMax: INVITE_REQUEST_NOTE_MAX,
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	requireAnonymous(context)
	requireWaitlist()
	const form = await readForm(request)
	const started = form.get("started")
	const parsed = parseForm(form, schema)
	// The time the form was first shown travels back with an error, so fixing a typo is not "too fast".
	const token = typeof started === "string" ? started : formToken()
	if (!parsed.ok)
		return data(
			{ fieldErrors: parsed.fieldErrors, formError: null, values: parsed.values, token },
			{ status: 400 },
		)
	let outcome: InviteRequestOutcome
	try {
		outcome = await requestInvite(
			{
				email: parsed.data.email,
				note: parsed.data.note,
				locale: getLocale(context),
				token: started,
				trap: form.get(TRAP),
			},
			request.headers,
		)
	} catch (error) {
		const limited = authLimitResponse(error)
		if (limited) throw limited
		throw error
	}
	if (outcome === "received") return { received: true as const }
	return data(
		{
			fieldErrors: {} as FieldErrors,
			formError:
				outcome === "expired"
					? ("auth:requestInvite.expired" as const)
					: ("auth:requestInvite.full" as const),
			values: { email: parsed.data.email, note: parsed.data.note ?? "" },
			token: outcome === "expired" ? formToken() : token,
		},
		{ status: outcome === "full" ? 503 : 400 },
	)
}

export default function RequestInvite({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("auth")
	const tk = useKeyTranslation()
	const isNsKey = useIsNsKey()
	const busy = useNavigation().state !== "idle"
	const noteId = useId()

	if (actionData && "received" in actionData) {
		return (
			<AuthCard title={t("requestInvite.receivedTitle")}>
				<p className="text-sm text-muted-fg">{t("requestInvite.received")}</p>
				<Link to="/" className="mt-6 inline-block text-sm text-link hover:underline">
					{t("requestInvite.backHome")}
				</Link>
			</AuthCard>
		)
	}

	const noteError = actionData?.fieldErrors?.note
	return (
		<AuthCard title={t("requestInvite.title")}>
			<p className="mb-4 text-sm text-muted-fg">{t("requestInvite.description")}</p>
			<Form method="post" className="flex flex-col gap-4">
				<input type="hidden" name="started" value={actionData?.token ?? loaderData.token} />
				<Field
					label={t("email")}
					name="email"
					type="email"
					autoComplete="email"
					required
					maxLength={254}
					defaultValue={actionData?.values?.email}
					error={actionData?.fieldErrors?.email}
				/>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={noteId}>{t("requestInvite.note")}</Label>
					<textarea
						id={noteId}
						name="note"
						rows={3}
						maxLength={loaderData.noteMax}
						defaultValue={actionData?.values?.note}
						aria-invalid={Boolean(noteError) || undefined}
						aria-describedby={`${noteId}-hint`}
						className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg shadow-xs placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger"
					/>
					<p
						id={`${noteId}-hint`}
						className={cn("text-sm", noteError ? "text-danger" : "text-muted-fg")}
					>
						{noteError
							? isNsKey(noteError)
								? tk(noteError, { max: loaderData.noteMax })
								: noteError
							: t("requestInvite.noteHint", { max: loaderData.noteMax })}
					</p>
				</div>
				{/* Off screen and out of the tab order; hidden from screen readers too. */}
				<div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
					<label>
						{t("requestInvite.trap")}
						<input type="text" name={TRAP} tabIndex={-1} autoComplete="off" defaultValue="" />
					</label>
				</div>
				{actionData?.formError ? (
					<p className="text-sm text-danger" role="alert">
						{tk(actionData.formError)}
					</p>
				) : null}
				<Button type="submit" disabled={busy}>
					{t("requestInvite.submit")}
				</Button>
			</Form>
			<p className="mt-6 text-sm text-muted-fg">
				{t("requestInvite.haveCode")}{" "}
				<Link to="/signup" className="text-link hover:underline">
					{t("requestInvite.signup")}
				</Link>
			</p>
		</AuthCard>
	)
}
