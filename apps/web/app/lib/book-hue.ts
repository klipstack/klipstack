/** A small, stable number for a text: a book keeps its height and color from one visit to the next. */
export function hash(text: string) {
	let h = 7
	for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0
	return h
}

/** A site's hue, one of twelve: its books on the shelves and its articles' covers share it. */
export function siteHue(site: string) {
	return (hash(site) % 12) * 30
}
