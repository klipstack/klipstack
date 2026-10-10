import { showToast } from "./toast"

/**
 * Deleting is instant and reversible, so the warning lands with the "Deleted" toast rather than
 * before it: this asks how many notes link to the article and, when some do, says so. A plain fetch,
 * not a fetcher: the card it started from is gone by the time the answer arrives.
 */
export function warnAboutBacklinks(
	documentId: string,
	message: (count: number) => string,
	undoLabel: string,
) {
	void fetch(`/documents/${documentId}/backlinks`)
		.then((res) => (res.ok ? (res.json() as Promise<{ count: number }>) : { count: 0 }))
		.then(({ count }) => {
			if (!count) return
			showToast({
				warn: true,
				message: message(count),
				undo: { action: `/documents/${documentId}/state`, intent: "restore", label: undoLabel },
			})
		})
		.catch(() => undefined)
}
