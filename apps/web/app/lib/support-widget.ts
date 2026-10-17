/** Where SuppyHQ serves its support widget: the script, the photo and the panel. */
export const SUPPYHQ_ORIGIN = "https://app.suppyhq.com"

/** A layout route's `handle` for pages that show the support button. */
export interface SupportWidgetHandle {
	supportWidget: true
}

/** What the root loader sends a signed-in user when the server has a SuppyHQ account. */
export interface SupportWidgetConfig {
	tenant: string
	email: string
	name: string
}
