/**
 * Large uploads (captured pages) hold megabytes until they finish: at most this many at once, per
 * owner and in all. The web's form and JSON reads and the HTTP API take slots from this one pool.
 */
export const LARGE_UPLOADS = { perOwner: 2, total: 6 }

const byOwner = new Map<string, number>()
let total = 0

/** A slot for a large upload, or null when none is left; the returned function gives it back. */
export function takeUploadSlot(owner: string, limits = LARGE_UPLOADS): (() => void) | null {
	const mine = byOwner.get(owner) ?? 0
	if (mine >= limits.perOwner || total >= limits.total) return null
	total++
	byOwner.set(owner, mine + 1)
	let released = false
	return () => {
		if (released) return
		released = true
		total--
		const left = (byOwner.get(owner) ?? 1) - 1
		if (left > 0) byOwner.set(owner, left)
		else byOwner.delete(owner)
	}
}
