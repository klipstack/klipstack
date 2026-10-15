import { tiltFor } from "./post-it"

/** How many ways a clipping is cut (`.clipping-paper[data-cut]` in app.css). */
const CUTS = 3

/**
 * A Notebook card's paper: a clipping cut from the page with scissors, never quite square, taped
 * to the wall at a corner. Goes first inside a `clipping` card; the card's padding leaves room
 * above the paper for the tape, which stays inside the card's box so a column break never strands
 * it at the foot of the column before. `id` chooses the cut and the tape, the same every time.
 */
export function ClippingPaper({ id }: { id: string }) {
	const cut = tiltFor(id) % CUTS
	return (
		<>
			<span aria-hidden="true" data-cut={cut} className="clipping-paper" />
			<span
				aria-hidden="true"
				data-testid="clipping-tape"
				data-cut={cut}
				className="clipping-tape"
			/>
		</>
	)
}
