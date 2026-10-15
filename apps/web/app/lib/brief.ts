/**
 * A brief's text, as the model writes it: a gist paragraph, then sections each opened by one of
 * these headings, in English whatever the language (`briefSystemPrompt` in `@klipstack/ai`). Briefs
 * written before the sections are three bullets. Safe to import from client code.
 */
export const BRIEF_SECTIONS = {
	"Key claims": "claims",
	"Keep in mind": "caveats",
	Parts: "parts",
} as const

export type BriefSection = (typeof BRIEF_SECTIONS)[keyof typeof BRIEF_SECTIONS]

/**
 * A heading line's section, or null for a line that isn't one of them. Forgiving of case and a
 * trailing colon, which a model may add.
 */
export function briefSection(heading: string): BriefSection | null {
	const bare = heading.trim().replace(/:$/, "").toLowerCase()
	for (const [title, section] of Object.entries(BRIEF_SECTIONS))
		if (title.toLowerCase() === bare) return section
	return null
}

/** The brief in a few lines: its gist, or the bullets of a brief written before the sections. */
export function briefSummary(text: string): string {
	const heading = text.search(/^##\s/m)
	if (heading >= 0) return text.slice(0, heading).trim()
	return text
		.split("\n")
		.map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
		.filter(Boolean)
		.join(" ")
}
