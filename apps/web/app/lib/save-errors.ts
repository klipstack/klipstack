/** The text the web shows for a refused save (`library:add.errors.*`), by the refusal's code. */
export function saveErrorKey(error: { code: string; details?: Record<string, unknown> }) {
	switch (error.code) {
		case "invalid_url":
		case "unsupported_twitter":
		case "unsupported_youtube":
		case "rate_limited":
			return `add.errors.${error.code}` as const
		case "limit_reached":
			return error.details?.limit === "storage"
				? ("add.errors.limit_storage" as const)
				: ("add.errors.limit_saves" as const)
		case "invalid_request":
			// More links than are saved at once (`SAVE_LINKS_MAX`): the list itself is too big.
			return tooMany(error.details)
				? ("add.errors.too_many" as const)
				: ("add.errors.invalid_url" as const)
		default:
			return "add.errors.failed" as const
	}
}

function tooMany(details: Record<string, unknown> | undefined) {
	const issues = details?.issues
	if (!Array.isArray(issues)) return false
	const first = issues[0] as { code?: string; path?: unknown[] } | undefined
	return first?.code === "too_big" && first.path?.length === 0
}
