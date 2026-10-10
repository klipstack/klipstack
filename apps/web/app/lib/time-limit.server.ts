/** A health check's read, given up after this long: a stuck dependency must not hang the page. */
export const CHECK_TIMEOUT_MS = 3_000

/** `read()`, or an error once `ms` pass first. */
export async function withinTime<T>(read: () => Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			read(),
			new Promise<never>((_, fail) => {
				timer = setTimeout(() => fail(new Error("timed out")), ms)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}
