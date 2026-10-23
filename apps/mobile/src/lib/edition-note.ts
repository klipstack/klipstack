import { NOTE_MAX } from "@klipstack/api-contract/names"
import { parse } from "@klipstack/api-contract/note-links"

/**
 * "Start from my note": the edition note with the private note added after it, to edit into
 * something for the edition's readers, as the web's (`editionNoteFromNote`). Links read as their titles (the edition's
 * readers can't open them) and each line is a paragraph. Null when there's nothing to add: no
 * note, or it is in the edition note already.
 */
export function editionFromNote(edition: string, note: string): string | null {
	const plain = parse(note)
		.map((line) =>
			line
				.map((s) => (s.kind === "text" ? s.text : s.title))
				.join("")
				.trim(),
		)
		.filter(Boolean)
		.join("\n\n")
	if (!plain || edition.includes(plain)) return null
	const before = edition.trimEnd()
	return (before ? `${before}\n\n${plain}` : plain).slice(0, NOTE_MAX)
}
