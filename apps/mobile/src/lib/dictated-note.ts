/**
 * The note while it is dictated: what was there when dictation began, then what is heard so far
 * (`heard`, which the recognizer rewrites as it goes), on a line of its own after any text, cut to
 * `max` characters.
 */
export function withDictated(before: string, heard: string, max: number): string {
	const spoken = heard.trim()
	if (!spoken) return before
	const start = before.trimEnd()
	return (start ? `${start}\n${spoken}` : spoken).slice(0, max)
}
