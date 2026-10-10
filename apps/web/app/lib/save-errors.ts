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
			return "add.errors.invalid_url" as const
		default:
			return "add.errors.failed" as const
	}
}
