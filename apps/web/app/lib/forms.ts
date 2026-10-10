import type { z } from "zod"

export type FieldErrors<T extends string = string> = Partial<Record<T, string>>

export type FormResult<T extends string = string> =
	| {
			status: "error"
			formError?: string
			fieldErrors?: FieldErrors<T>
			values?: Record<string, string>
	  }
	| { status: "success" }

/**
 * Parse a FormData against a zod object schema. Returns typed data or per-field error message keys.
 * Error messages should be i18n keys (e.g. "auth:validation.required") and resolved in the UI.
 */
export function parseForm<S extends z.ZodObject>(
	formData: FormData,
	schema: S,
):
	| { ok: true; data: z.infer<S> }
	| { ok: false; fieldErrors: FieldErrors; values: Record<string, string> } {
	const values: Record<string, string> = {}
	for (const [key, value] of formData.entries()) if (typeof value === "string") values[key] = value
	const result = schema.safeParse(values)
	if (result.success) return { ok: true, data: result.data }
	const fieldErrors: FieldErrors = {}
	for (const issue of result.error.issues) {
		const key = String(issue.path[0] ?? "form")
		if (!fieldErrors[key]) fieldErrors[key] = issue.message
	}
	// Only declared, non-secret text fields may be sent back to the browser.
	const safeValues: Record<string, string> = {}
	for (const key of Object.keys(schema.shape)) {
		if (!/password|token|secret/i.test(key) && values[key] !== undefined)
			safeValues[key] = values[key]
	}
	return { ok: false, fieldErrors, values: safeValues }
}
