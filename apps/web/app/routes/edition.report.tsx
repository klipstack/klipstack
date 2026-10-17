import { useId } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, useNavigation } from "react-router"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { Label } from "~/components/ui/label"
import { REPORT_REASONS, REPORT_TRAP } from "~/lib/edition-reports"
import { reportEdition } from "~/lib/edition-reports.server"
import { editionSlug, editionTitle } from "~/lib/editions"
import { useIsNsKey, useKeyTranslation } from "~/lib/i18n-keys"
import { getInstance, getLocale } from "~/lib/i18n.server"
import { reportAction, reportLoader } from "~/lib/report-form.server"
import { cn } from "~/lib/utils"
import { getPublicEdition, parseSnapshot } from "~/services/editions.server"
import type { Route } from "./+types/edition.report"

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
	return reportLoader(
		getInstance(context).t("editions:report.title"),
		await publicEdition(params.publicId),
	)
}

export function action({ request, context, params }: Route.ActionArgs) {
	return reportAction(request, getLocale(context), (input) =>
		reportEdition({ ...input, publicId: params.publicId }, request.headers),
	)
}

export default function ReportEdition({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("editions")
	const tk = useKeyTranslation()
	const isNsKey = useIsNsKey()
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
						<input
							type="text"
							name={REPORT_TRAP}
							tabIndex={-1}
							autoComplete="off"
							defaultValue=""
						/>
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
