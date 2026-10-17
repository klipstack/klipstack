/**
 * What waits for the reader's consent before a question goes to the AI provider. `request` runs at
 * once when the account agreed; otherwise it keeps what was asked for and opens the sheet (`ask`).
 * What was kept runs once the sheet is gone (`dismissed`), and only after `given`: Not Now, or
 * closing the sheet, sends nothing.
 */
export function createConsentGate(ask: () => void) {
	let pending: (() => void) | null = null
	let given = false
	return {
		request(consented: boolean, run: () => void) {
			if (consented) return run()
			pending = run
			given = false
			ask()
		},
		/** The account agreed (`PUT /ai/consent` answered). */
		given() {
			given = true
		},
		/** The sheet is gone, however it was closed. */
		dismissed() {
			const run = given ? pending : null
			pending = null
			given = false
			run?.()
		},
	}
}
