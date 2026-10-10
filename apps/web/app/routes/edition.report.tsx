import { useId } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, useNavigation } from "react-router"
import { z } from "zod"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { Label } from "~/components/ui/label"
import { authLimitResponse } from "~/lib/auth-limits.server"
import { REPORT_DETAILS_MAX, REPORT_REASONS } from "~/lib/edition-reports"
import { type ReportOutcome, reportEdition } from "~/lib/edition-reports.server"
import { editionSlug, editionTitle } from "~/lib/editions"
import { type FieldErrors, parseForm } from "~/lib/forms"
import { isNsKey, useKeyTranslation } from "~/lib/i18n-keys"
import { getInstance, getLocale } from "~/lib/i18n.server"
import { formToken } from "~/lib/invite-requests.server"
import { readForm } from "~/lib/request-body.server"
import { cn } from "~/lib/utils"
import { getPublicEdition, parseSnapshot } from "~/services/editions.server"
import type { Route } from "./+types/edition.report"

/** The field only bots fill: people never see it. No name a browser's autofill would recognize. */
const TRAP = "kp_extra"

const schema = z.object({
	reason: z.enum(REPORT_REASONS, "editions:report.errors.reason"),
	details: z
		.string()
		.trim()
		.min(1, "editions:report.errors.details")
		.max(REPORT_DETAILS_MAX, "editions:report.errors.detailsTooLong"),
	email: z.union([z.literal(""), z.email("auth:validation.emailInvalid").max(254)]).optional(),
})

export function meta({ loaderData }: Route.MetaArgs) {
	return [
		{ title: loaderData ? `${loaderData.pageTitle} · Klipstack` : "Klipstack" },
		{ name: "robots", content: "noindex" },
	]
}

/** The edition the form is about: public, and not removed. Anything else is gone. */
async function publicEdition(publicId: string) {
	const edition = await getPublicEdition(publicId)
	if (!edition) throw data(null, { status: 404 })
	// Taken down by an admin, the page says so: not that its author did.
	if (edition.removedAt) throw data({ removed: true }, { status: 410 })
	if (edition.unpublishedAt) throw data(null, { status: 410 })
	const snapshot = parseSnapshot(edition.published)
	if (!snapshot) throw new Error(`Edition ${publicId}: a snapshot this code cannot read`)
	// Never null here: `getPublicEdition` finds published editions only.
	const published = { ...edition, publishedAt: edition.publishedAt!, locale: snapshot.locale }
	return {
		title: editionTitle(snapshot.title, published),
		path: `/e/${publicId}/${editionSlug(snapshot.title, published.publishedAt, edition.timeZone)}`,
	}
}

/** GET /e/:publicId/report — anyone may report a public edition; signed in or not. */
export async function loader({ params, context }: Route.LoaderArgs) {
	const edition = await publicEdition(params.publicId)
	return {
		pageTitle: getInstance(context).t("editions:report.title"),
		edition,
		token: formToken(Date.now(), "edition-report"),
		detailsMax: REPORT_DETAILS_MAX,
	}
}

export async function action({ request, context, params }: Route.ActionArgs) {
	const form = await readForm(request)
	const started = form.get("started")
	const parsed = parseForm(form, schema)
	// The time the form was first shown travels back with an error, so fixing one is not "too fast".
	const token = typeof started === "string" ? started : formToken(Date.now(), "edition-report")
	if (!parsed.ok)
		return data(
			{ fieldErrors: parsed.fieldErrors, formError: null, values: parsed.values, token },
			{ status: 400 },
		)
	let outcome: ReportOutcome
	try {
		outcome = await reportEdition(
			{
				publicId: params.publicId,
				reason: parsed.data.reason,
				details: parsed.data.details,
				email: parsed.data.email || null,
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
					? ("editions:report.expired" as const)
					: ("editions:report.full" as const),
			values: {
				reason: parsed.data.reason,
				details: parsed.data.details,
				email: parsed.data.email ?? "",
			},
			token: outcome === "expired" ? formToken(Date.now(), "edition-report") : token,
		},
		{ status: outcome === "full" ? 503 : 400 },
	)
}

export default function ReportEdition({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("editions")
	const tk = useKeyTranslation()
	// A server message is a key, or plain text when it is zod's own.
	const say = (message: string, options?: { max: number }) =>
		isNsKey(message) ? tk(message, options) : message
	const busy = useNavigation().state !== "idle"
	const detailsId = useId()
	const reasonId = useId()
	const { edition } = loaderData

	if (actionData && "received" in actionData) {
		return (
			<AuthCard title={t("report.receivedTitle")}>
				<p className="text-sm text-muted-fg">{t("report.received")}</p>
				<a href={edition.path} className="mt-6 inline-block text-sm text-link hover:underline">
					{t("report.back")}
				</a>
			</AuthCard>
		)
	}

	const values = actionData?.values
	const errors = actionData?.fieldErrors
	return (
		<AuthCard title={t("report.title")}>
			<p className="mb-4 text-sm text-muted-fg">
				{t("report.description", { title: edition.title })}
			</p>
			<Form method="post" className="flex flex-col gap-4">
				<input type="hidden" name="started" value={actionData?.token ?? loaderData.token} />
				<fieldset
					className="flex flex-col gap-2"
					aria-describedby={errors?.reason ? reasonId : undefined}
				>
					<legend className="mb-1 text-sm font-medium">{t("report.reason")}</legend>
					{REPORT_REASONS.map((reason) => (
						<label key={reason} className="flex items-start gap-2 text-sm">
							<input
								type="radio"
								name="reason"
								value={reason}
								required
								defaultChecked={values?.reason === reason}
								className="mt-0.5"
							/>
							{t(`report.reasons.${reason}`)}
						</label>
					))}
					{errors?.reason ? (
						<p id={reasonId} className="text-sm text-danger">
							{say(errors.reason)}
						</p>
					) : null}
				</fieldset>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={detailsId}>{t("report.details")}</Label>
					<textarea
						id={detailsId}
						name="details"
						rows={4}
						required
						maxLength={loaderData.detailsMax}
						defaultValue={values?.details}
						aria-invalid={Boolean(errors?.details) || undefined}
						aria-describedby={`${detailsId}-hint`}
						className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg shadow-xs placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger"
					/>
					<p
						id={`${detailsId}-hint`}
						className={cn("text-sm", errors?.details ? "text-danger" : "text-muted-fg")}
					>
						{errors?.details
							? say(errors.details, { max: loaderData.detailsMax })
							: t("report.detailsHint")}
					</p>
				</div>
				<Field
					label={t("report.email")}
					name="email"
					type="email"
					autoComplete="email"
					maxLength={254}
					defaultValue={values?.email}
					error={errors?.email}
					hint={t("report.emailHint")}
				/>
				{/* Off screen and out of the tab order; hidden from screen readers too. */}
				<div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
					<label>
						{t("report.trap")}
						<input type="text" name={TRAP} tabIndex={-1} autoComplete="off" defaultValue="" />
					</label>
				</div>
				{actionData?.formError ? (
					<p className="text-sm text-danger" role="alert">
						{say(actionData.formError)}
					</p>
				) : null}
				<Button type="submit" disabled={busy}>
					{t("report.submit")}
				</Button>
			</Form>
			<a href={edition.path} className="mt-6 inline-block text-sm text-link hover:underline">
				{t("report.back")}
			</a>
		</AuthCard>
	)
}
