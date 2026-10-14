import {
	type ArticleDetails,
	type ArticleSummary,
	KlipstackApiError,
	type KlipstackClient,
	KlipstackContractError,
	KlipstackInputError,
} from "@klipstack/sdk"
import { Directory, File, Paths } from "expo-file-system"
import { readerFolder } from "./reader-files"

/**
 * Offline reading, as the web's service worker does it (apps/web/public/sw.js): the lists Home,
 * Inbox and Starred showed last, and the articles in them, each with its stored images. Archive,
 * Trash, tags, saved searches and search are never kept. Everything is in the cache folder, which
 * the system may clear when the phone runs low on space, and sign-out deletes
 * (`forgetReadArticles`).
 *
 * An article's copy is `article.json` in its reader folder (reader-files.ts), beside the page and
 * images the reader writes there.
 */

export type StoredHtml = Awaited<ReturnType<KlipstackClient["articles"]["html"]>>

/** What the reader needs to open an article without the server. */
export type OfflineArticle = { details: ArticleDetails; stored: StoredHtml; savedAt: number }

/** The lists kept: Home's four, and the first page of Inbox and Starred. */
export type OfflineList =
	| "home-reading"
	| "home-unread"
	| "home-quick"
	| "home-long"
	| "home-again"
	| "inbox"
	| "starred"

/** What a kept list says when it shows what the phone kept. */
export const OFFLINE_NOTE = "Can't reach Klipstack. Articles kept on this phone still open."

/** The reader's message for an article opened offline that the phone didn't keep. */
export const NOT_KEPT = "This article isn't on this phone yet. Connect to the internet to read it."

/** The most articles kept, as the web keeps 300 pages; the oldest go first. */
export const MAX_ARTICLES = 300
/** And the most space they take, images included. */
export const MAX_BYTES = 500 * 1024 * 1024

/**
 * Whether a failed request is worth answering from the phone: no connection, a timeout, the server
 * down. Not an answer that says no (signed out, gone, refused): what is kept may be wrong then.
 */
export function canUseOffline(error: unknown): boolean {
	return lostConnection(error) || (error instanceof KlipstackApiError && error.status >= 500)
}

/**
 * No answer at all: the request never reached the server, or its answer never came back. Expo's
 * `fetch` rejects with its own errors then ("fetch failed: … Could not connect to the server"),
 * so anything but the SDK's errors counts.
 */
export function lostConnection(error: unknown): boolean {
	return !(
		error instanceof KlipstackApiError ||
		error instanceof KlipstackInputError ||
		error instanceof KlipstackContractError
	)
}

function listsFolder(): Directory {
	const folder = new Directory(Paths.cache, "offline-lists")
	folder.create({ intermediates: true, idempotent: true })
	return folder
}

export function saveList(list: OfflineList, items: ArticleSummary[]): void {
	try {
		const file = new File(listsFolder(), `${list}.json`)
		file.create({ overwrite: true })
		file.write(JSON.stringify(items))
	} catch {
		// Offline, the list is older or missing; online, nothing changes.
	}
}

export function loadList(list: OfflineList): ArticleSummary[] | null {
	try {
		const file = new File(listsFolder(), `${list}.json`)
		if (!file.exists) return null
		const items: unknown = JSON.parse(file.textSync())
		return Array.isArray(items) ? (items as ArticleSummary[]) : null
	} catch {
		return null
	}
}

/** The lists kept, at sign-out. */
export function forgetLists(): void {
	const folder = new Directory(Paths.cache, "offline-lists")
	if (folder.exists) folder.delete()
}

export function saveArticle(details: ArticleDetails, stored: StoredHtml, now = Date.now()): void {
	try {
		const file = new File(readerFolder(details.id), "article.json")
		file.create({ overwrite: true })
		file.write(JSON.stringify({ details, stored, savedAt: now } satisfies OfflineArticle))
	} catch {
		// The article opens only online, as before.
	}
}

export function loadArticle(id: string): OfflineArticle | null {
	try {
		const file = new File(new Directory(Paths.cache, "reader", id), "article.json")
		if (!file.exists) return null
		const saved = JSON.parse(file.textSync()) as Partial<OfflineArticle>
		if (!saved.details || typeof saved.stored?.html !== "string") return null
		return { details: saved.details, stored: saved.stored, savedAt: saved.savedAt ?? 0 }
	} catch {
		return null
	}
}

/**
 * Deletes the copies over the limits: first those of articles no longer in a kept list (`keep`),
 * the least recently written first, then the kept ones from the end of `keep`. A folder counts its
 * images too. Folders the reader wrote without an `article.json` (opened only) count as well.
 */
export function pruneArticles(
	keep: readonly string[],
	{ maxArticles = MAX_ARTICLES, maxBytes = MAX_BYTES } = {},
): string[] {
	const root = new Directory(Paths.cache, "reader")
	if (!root.exists) return []
	const rank = new Map(keep.map((id, i) => [id, i]))
	const folders = root
		.list()
		.filter((entry): entry is Directory => entry instanceof Directory)
		.map((folder) => ({
			folder,
			kept: rank.get(folder.name),
			at: folderTime(folder),
			bytes: folderBytes(folder),
		}))
	// Kept first, in list order; then the others, newest first.
	folders.sort((a, b) =>
		a.kept !== undefined || b.kept !== undefined
			? (a.kept ?? Infinity) - (b.kept ?? Infinity)
			: b.at - a.at,
	)
	const deleted: string[] = []
	let count = 0
	let bytes = 0
	for (const entry of folders) {
		count++
		bytes += entry.bytes
		if (count <= maxArticles && bytes <= maxBytes) continue
		try {
			entry.folder.delete()
			deleted.push(entry.folder.name)
		} catch {
			// Tried again after the next download.
		}
		count--
		bytes -= entry.bytes
	}
	return deleted
}

function folderTime(folder: Directory): number {
	try {
		return new File(folder, "article.json").modificationTime ?? 0
	} catch {
		return 0
	}
}

function folderBytes(folder: Directory): number {
	try {
		return folder.size ?? 0
	} catch {
		return 0
	}
}
