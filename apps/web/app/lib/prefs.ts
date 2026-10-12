import type { UserPrefs } from "@klipstack/db"

export const DEFAULT_PREFS: Required<UserPrefs> = {
	font: "serif",
	fontSize: "md",
	width: "normal",
	theme: "system",
	shortcuts: "on",
	editionsNudgeAfter: null,
	reviewSuggestAfter: null,
	topicsInvitationEndedAt: null,
	linkEditions: "off",
}

export function resolvePrefs(prefs: UserPrefs | null | undefined): Required<UserPrefs> {
	return { ...DEFAULT_PREFS, ...prefs }
}

export function readerClassNames(prefs: Required<UserPrefs>): string {
	return `reader-font-${prefs.font} reader-size-${prefs.fontSize} reader-width-${prefs.width}`
}
