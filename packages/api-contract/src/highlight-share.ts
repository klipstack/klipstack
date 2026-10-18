/**
 * A highlight as text to share: the quote, the reader's note under it and the article it came from,
 * linked. Markdown for the plain-text clipboard, HTML for apps that paste rich text, and plain text
 * for a phone's share sheet, where Markdown shows as typed. Framework-free,
 * so the web app and the mobile app write the same thing.
 */
import { parse, type Segment } from "./note-links"

export interface ShareableHighlight {
	exact: string
	note: string | null
	article: { title: string | null; url: string; siteName: string | null; author?: string | null }
	/**
	 * The original address of each article the note links to, by id. A note's links point into the
	 * reader's own library, where nobody else can follow them: they go to these instead, and one
	 * without an address here stays its title, as text.
	 */
	linkUrls?: Record<string, string>
}

export interface ShareText {
	markdown: string
	html: string
	/** No markup: the quote in quotation marks, a link's address after its words, in brackets. */
	plain: string
}

/** The highlight as Markdown, HTML and plain text; `withNote` false leaves the note out. */
export function highlightShareText(h: ShareableHighlight, withNote = true): ShareText {
	const quote = paragraphs(h.exact)
	const note = withNote && h.note ? noteParagraphs(h.note, h.linkUrls ?? {}) : []
	const { name, site, href } = credit(h.article)
	const by = articleAuthor(h.article)
	const after = [by, site].filter(Boolean).join(", ")

	const markdown = [
		quote.map((p) => `> ${p}`).join("\n>\n"),
		...note.map((p) => p.map((s) => (s.href ? markdownLink(s.text, s.href) : s.text)).join("")),
		`— ${href ? markdownLink(name, href) : name}${after ? `, ${after}` : ""}`,
	].join("\n\n")

	const html = [
		`<blockquote>${quote.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</blockquote>`,
		...note.map(
			(p) =>
				`<p>${p.map((s) => (s.href ? htmlLink(s.text, s.href) : escapeHtml(s.text))).join("")}</p>`,
		),
		`<p>— ${href ? htmlLink(name, href) : escapeHtml(name)}${after ? `, ${escapeHtml(after)}` : ""}</p>`,
	].join("")

	const plain = [
		`“${quote.join("\n")}”`,
		...note.map((p) => p.map((s) => (s.href ? `${s.text} (${s.href})` : s.text)).join("")),
		`— ${name}${after ? `, ${after}` : ""}${href ? `\n${href}` : ""}`,
	].join("\n\n")

	return { markdown, html, plain }
}

/**
 * Who wrote the article, to credit beside its site: null when there is no author, or when the
 * author only repeats the site's name or the title, as some sites' metadata does.
 */
export function articleAuthor(article: {
	author?: string | null
	siteName: string | null
	title: string | null
}): string | null {
	const author = article.author?.replace(/\s+/g, " ").trim()
	if (!author) return null
	const same = (other: string | null) => other?.trim().toLowerCase() === author.toLowerCase()
	return same(article.siteName) || same(article.title) ? null : author
}

/** Text as its paragraphs: one per line, spaces tidied, blank lines dropped. */
function paragraphs(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean)
}

/** A note's paragraphs as runs of text, each with the address it links to, if any. */
function noteParagraphs(
	note: string,
	urls: Record<string, string>,
): Array<Array<{ text: string; href: string | null }>> {
	return parse(note)
		.map((line) =>
			tidy(
				line.map((s: Segment) =>
					s.kind === "text"
						? { text: s.text, href: null }
						: { text: s.title, href: webHref(urls[s.id] ?? "") },
				),
			),
		)
		.filter((line) => line.length > 0)
}

/** Spaces tidied across a line's runs, as `paragraphs` tidies plain text; empty runs dropped. */
function tidy(runs: Array<{ text: string; href: string | null }>) {
	const out = runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ") }))
	if (out[0]) out[0].text = out[0].text.trimStart()
	const last = out.at(-1)
	if (last) last.text = last.text.trimEnd()
	// A link with no title still needs words to click: its address's host.
	return out
		.map((r) => (r.href && !r.text.trim() ? { ...r, text: new URL(r.href).hostname } : r))
		.filter((r) => r.text)
}

/** The address, normalized, when it is a web one; null otherwise. */
function webHref(url: string): string | null {
	try {
		const parsed = new URL(url)
		return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null
	} catch {
		return null
	}
}

function markdownLink(text: string, href: string): string {
	return `[${escapeLinkText(text)}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})`
}

function htmlLink(text: string, href: string): string {
	return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
}

/**
 * What the credit line says: the article's title (else its site, else its host), the site after it
 * when that is something else, and the address, when it is a web one.
 */
function credit(article: ShareableHighlight["article"]) {
	const href = webHref(article.url)
	const title = article.title?.trim() || null
	const siteName = article.siteName?.trim() || null
	const name =
		title ?? siteName ?? (href ? new URL(href).hostname.replace(/^www\./, "") : article.url)
	const site = title && siteName && siteName !== title ? siteName : null
	return { name, site, href }
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
