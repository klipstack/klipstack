/**
 * A highlight as text to share: the quote, the reader's note under it and the article it came from,
 * linked. Markdown for the plain-text clipboard, HTML for apps that paste rich text. Framework-free,
 * so the web app and the mobile app write the same thing.
 */
import { rewriteNoteLinks } from "./note-links"

export interface ShareableHighlight {
	exact: string
	note: string | null
	article: { title: string | null; url: string; siteName: string | null }
}

export interface ShareText {
	markdown: string
	html: string
}

/** The highlight as Markdown and HTML; `withNote` false leaves the note out. */
export function highlightShareText(h: ShareableHighlight, withNote = true): ShareText {
	const quote = paragraphs(h.exact)
	// Links to the reader's library lead nowhere for anyone else: their titles stay, as plain text.
	const note = withNote && h.note ? paragraphs(rewriteNoteLinks(h.note, () => null)) : []
	const { name, site, href } = credit(h.article)

	const markdown = [
		quote.map((p) => `> ${p}`).join("\n>\n"),
		...note,
		`— ${href ? `[${escapeLinkText(name)}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})` : name}${site ? `, ${site}` : ""}`,
	].join("\n\n")

	const html = [
		`<blockquote>${quote.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</blockquote>`,
		...note.map((p) => `<p>${escapeHtml(p)}</p>`),
		`<p>— ${href ? `<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>` : escapeHtml(name)}${site ? `, ${escapeHtml(site)}` : ""}</p>`,
	].join("")

	return { markdown, html }
}

/** Text as its paragraphs: one per line, spaces tidied, blank lines dropped. */
function paragraphs(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean)
}

/**
 * What the credit line says: the article's title (else its site, else its host), the site after it
 * when that is something else, and the address, when it is a web one.
 */
function credit(article: ShareableHighlight["article"]) {
	let url: URL | null = null
	try {
		url = new URL(article.url)
	} catch {}
	const web = url && (url.protocol === "https:" || url.protocol === "http:") ? url : null
	const title = article.title?.trim() || null
	const siteName = article.siteName?.trim() || null
	const name = title ?? siteName ?? web?.hostname.replace(/^www\./, "") ?? article.url
	const site = title && siteName && siteName !== title ? siteName : null
	return { name, site, href: web?.href ?? null }
}

function escapeLinkText(text: string): string {
	return text.replace(/[[\]\\]/g, "\\$&")
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}
