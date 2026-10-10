// Loaded only by Playwright's server process. Exercise the real email code without sending mail.
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Tests read the last message to an address from here (helpers.ts `lastEmailTo`). */
const OUTBOX = join(tmpdir(), "klipstack-e2e-mail")
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : input)
	if (url.hostname !== "api.resend.com") return originalFetch(input, init)
	const request = new Request(input, init)
	const email = await request.json()
	const recipients = [].concat(email.to)
	if (url.pathname !== "/emails" || !recipients.every((to) => to.endsWith("@example.com")))
		throw new Error("Unexpected email request in browser tests")
	if (recipients.some((to) => to.startsWith("email-failure+")))
		return Response.json(
			{ name: "application_error", message: "Test delivery failure" },
			{ status: 500 },
		)
	mkdirSync(OUTBOX, { recursive: true })
	for (const to of recipients)
		writeFileSync(join(OUTBOX, `${encodeURIComponent(to)}.json`), JSON.stringify(email))
	return Response.json({ id: crypto.randomUUID() })
}
