import { File, Paths } from "expo-file-system"
import { Share } from "react-native"

/**
 * The whole library as Settings on the web exports it (`GET /export`, a zip of Markdown and JSON),
 * downloaded to the cache and offered to the share sheet, where "Save to Files" keeps it. `headers`:
 * the session's (`imageHeaders`), for the session's own server only. False when the reader closed
 * the sheet without sharing it.
 */
export async function exportLibrary(
	apiUrl: string,
	headers: Record<string, string>,
	today = new Date(),
): Promise<boolean> {
	const file = new File(Paths.cache, `klipstack-${today.toISOString().slice(0, 10)}.zip`)
	if (file.exists) file.delete()
	try {
		await File.downloadFileAsync(`${apiUrl}/api/v1/export?format=zip`, file, { headers })
		const { action } = await Share.share({ url: file.uri })
		return action === Share.sharedAction
	} finally {
		// The copy shared (or saved to Files) is the reader's; this one goes.
		if (file.exists) file.delete()
	}
}
