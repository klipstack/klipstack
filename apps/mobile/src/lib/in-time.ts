/**
 * What `promise` gives within `ms` milliseconds; null when it takes longer or fails. For what a
 * screen can open without, so a slow call doesn't hold it.
 */
export function inTime<T>(promise: Promise<T>, ms: number): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const late = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), ms)
	})
	return Promise.race([promise.catch(() => null), late]).finally(() => clearTimeout(timer))
}
