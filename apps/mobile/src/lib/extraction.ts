import type { KlipstackClient } from "@klipstack/sdk"

/**
 * Waits while the server reads an article again (a retry, the post instead), checking each second
 * for up to 20: done when its status is no longer queued or processing, or when the time is up.
 */
export async function waitForExtraction(client: KlipstackClient, id: string): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 1000))
		const details = await client.articles.get(id)
		if (details.status !== "queued" && details.status !== "processing") return
	}
}
