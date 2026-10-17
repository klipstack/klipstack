import { data } from "react-router"
import { z } from "zod"
import { authLimitResponse } from "./auth-limits.server"
import { REPORT_DETAILS_MAX, REPORT_REASONS, REPORT_TRAP } from "./edition-reports"
import type { reportEdition, ReportOutcome } from "./edition-reports.server"
import { type FieldErrors, parseForm } from "./forms"
import { formToken } from "./invite-requests.server"
import { readForm } from "./request-body.server"

/**
 * The report form's server half, for an edition's page and a shared highlight's alike
 * (`routes/edition.report.tsx`, `routes/highlight.report.tsx`).
 */

const schema = z.object({
	reason: z.enum(REPORT_REASONS, "editions:report.errors.reason"),
	details: z
		.string()
		.trim()
		.min(1, "editions:report.errors.details")
		.max(REPORT_DETAILS_MAX, "editions:report.errors.detailsTooLong"),
	email: z.union([z.literal(""), z.email("auth:validation.emailInvalid").max(254)]).optional(),
})

/** The form's page, about the public page `edition` (its title and address). */
export function reportLoader(pageTitle: string, edition: { title: string; path: string }) {
	return {
		pageTitle,
		edition,
		token: formToken(Date.now(), "edition-report"),
		detailsMax: REPORT_DETAILS_MAX,
	}
}

/**
 * A report form's answer, for an edition's and a shared highlight's alike: `report` stores it, or
 * not (see `ReportOutcome`).
 */
export async function reportAction(
	request: Request,
	locale: string,
	report: (input: Omit<Parameters<typeof reportEdition>[0], "publicId">) => Promise<ReportOutcome>,
) {
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
		outcome = await report({
			reason: parsed.data.reason,
			details: parsed.data.details,
			email: parsed.data.email || null,
			locale,
			token: started,
			trap: form.get(REPORT_TRAP),
		})
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
