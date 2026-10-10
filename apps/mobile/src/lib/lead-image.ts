export type LeadImage = { url: string; downloadUrl: string | null } | null | undefined

export type ImageSource = { uri: string; headers?: Record<string, string> }

/**
 * Where a card loads its picture from. A stored copy comes through the API with the app's token,
 * so only from the app's own server; a site's own image comes from the site, without it. Nothing
 * for a stored copy's browser URL, which needs the web session, or for plain http (iOS refuses it).
 */
export function leadImageSource(
	image: LeadImage,
	apiUrl: string,
	headers: Record<string, string> | null,
): ImageSource | null {
	if (!image) return null
	if (image.downloadUrl) {
		if (!headers || originOf(image.downloadUrl) !== originOf(apiUrl)) return null
		return { uri: image.downloadUrl, headers }
	}
	return image.url.startsWith("https://") ? { uri: image.url } : null
}

function originOf(url: string): string | null {
	try {
		return new URL(url).origin
	} catch {
		return null
	}
}
