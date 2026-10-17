/** Where SuppyHQ serves the support panel. */
export const SUPPYHQ_ORIGIN = "https://app.suppyhq.com"

/** The panel's copy, in the reader's language. */
export interface SupportPanelCopy {
	label: string
	headline: string
	successTitle: string
	successMessage: string
}

/**
 * SuppyHQ's panel page, which its own embed script frames: every setting rides in the address. The
 * app frames it itself, so none of SuppyHQ's code runs in the app's pages. Not a documented API:
 * if SuppyHQ changes it, the panel stops loading and `SupportPanel` offers the email instead.
 */
export function supportPanelUrl(
	tenant: string,
	user: { email: string; name: string },
	copy: SupportPanelCopy,
	theme: "light" | "dark",
): string {
	const url = new URL(`/widget/${encodeURIComponent(tenant)}/panel`, SUPPYHQ_ORIGIN)
	const params = {
		user_email: user.email,
		user_name: user.name,
		avatar_mode: "face",
		label: copy.label,
		theme,
		headline: copy.headline,
		success_title: copy.successTitle,
		success_message: copy.successMessage,
	}
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
	return url.href
}
