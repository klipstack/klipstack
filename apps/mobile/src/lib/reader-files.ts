import type { KlipstackClient } from "@klipstack/sdk"
import { Directory, File, Paths } from "expo-file-system"
import { parseColorScheme } from "./color-scheme"
import { parseListLayout } from "./list-layout"
import { parseZoomed } from "./notebook"
import { parseTypePrefs } from "./reader-type"
import { parseShareTab } from "./share-highlight"
import { parseSpeechPrefs } from "./speech"

/**
 * An article's page and its stored images, in the cache (the system may clear it; the reader
 * downloads again). The WebView loads the page from here and may read only this folder.
 */
export function readerFolder(articleId: string): Directory {
	const folder = new Directory(Paths.cache, "reader", articleId)
	folder.create({ intermediates: true, idempotent: true })
	return folder
}

/** Every article read on this device: signing out must not leave the library readable. */
export function forgetReadArticles(): void {
	const all = new Directory(Paths.cache, "reader")
	if (all.exists) all.delete()
}

export function writePage(folder: Directory, html: string): File {
	const page = new File(folder, "index.html")
	page.create({ overwrite: true })
	page.writeSync(html)
	return page
}

const EXTENSIONS: Record<string, string> = {
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/avif": ".avif",
	"image/svg+xml": ".svg",
}

/**
 * A stored image in the folder, downloaded through the API with the app's token when it isn't
 * there yet. Named `<asset id><extension>`: WebKit reads a local file's type from its extension.
 * Returns the file name, relative to the page.
 */
export async function storeAsset(
	folder: Directory,
	assetId: string,
	client: KlipstackClient,
): Promise<string> {
	const known = folder.list().find((f) => f instanceof File && f.name.startsWith(assetId))
	if (known) return known.name
	const response = await client.assets.download(assetId)
	const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? ""
	// The whole body first: a download cut short must not leave a file that counts as stored.
	const bytes = new Uint8Array(await response.arrayBuffer())
	if (bytes.length === 0) throw new Error(`Image ${assetId} came back empty`)
	const file = new File(folder, `${assetId}${EXTENSIONS[type] ?? ""}`)
	file.create({ overwrite: true })
	file.writeSync(bytes)
	return file.name
}

/**
 * One setting kept as a JSON file in the documents folder. `parse` turns the file's text (null
 * when there is none) into the setting, and gives the default for anything it cannot read. A failed
 * write keeps the setting until the app closes.
 */
function jsonSetting<T>(name: string, parse: (raw: string | null) => T) {
	const file = () => new File(Paths.document, name)
	return {
		load(): T {
			try {
				const saved = file()
				return parse(saved.exists ? saved.textSync() : null)
			} catch {
				return parse(null)
			}
		},
		save(value: T): void {
			try {
				const saved = file()
				saved.create({ overwrite: true })
				saved.writeSync(JSON.stringify(value))
			} catch {
				// The setting still applies until the app closes.
			}
		},
	}
}

/** The reader's type settings. */
const typePrefs = jsonSetting("reader-type.json", parseTypePrefs)
export const loadTypePrefs = typePrefs.load
export const saveTypePrefs = typePrefs.save

/** The chosen voices and reading speed. */
const speechPrefs = jsonSetting("speech.json", parseSpeechPrefs)
export const loadSpeechPrefs = speechPrefs.load
export const saveSpeechPrefs = speechPrefs.save

/** Light or dark mode as chosen in Appearance; the system's when none was. */
const colorScheme = jsonSetting("color-scheme.json", parseColorScheme)
export const loadColorScheme = colorScheme.load
export const saveColorScheme = colorScheme.save

/** The clipboard's change count when its link was last offered, saved or copied by the app. */
const clipboardSeen = jsonSetting("clipboard-seen.json", (raw): number | null => {
	const seen: unknown = raw ? JSON.parse(raw) : null
	return typeof seen === "number" ? seen : null
})
export const loadClipboardSeen = clipboardSeen.load
export const saveClipboardSeen: (count: number) => void = clipboardSeen.save

/** The library's lists as a grid or as rows; the grid when none was chosen. */
const listLayout = jsonSetting("list-layout.json", parseListLayout)
export const loadListLayout = listLayout.load
export const saveListLayout = listLayout.save

/** Whether the Notebook is zoomed out to two columns of small cards; not until chosen. */
const notebookZoom = jsonSetting("notebook-zoom.json", parseZoomed)
export const loadNotebookZoom = notebookZoom.load
export const saveNotebookZoom = notebookZoom.save

/** The Share sheet's tab chosen last: text, link or image. */
const shareTab = jsonSetting("share-tab.json", parseShareTab)
export const loadShareTab = shareTab.load
export const saveShareTab = shareTab.save

/**
 * A highlight's picture to share, in the cache: one file per highlight and shape, written anew
 * each time it is drawn, and shared from here (the share sheet needs a file).
 */
export function writeShareImage(highlightId: string, shape: string, bytes: Uint8Array): File {
	const folder = new Directory(Paths.cache, "share")
	folder.create({ intermediates: true, idempotent: true })
	const file = new File(folder, `highlight-${highlightId}-${shape}.png`)
	file.create({ overwrite: true })
	file.writeSync(bytes)
	return file
}
