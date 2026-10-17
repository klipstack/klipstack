import { HIGHLIGHT_COLORS, type HighlightColor } from "@klipstack/api-contract/enums"
import type { ArticleTopics } from "@klipstack/sdk"
import type { PageConfig, PageHighlight } from "@/page/messages"
import { pageScript, pageScriptHash } from "./reader-page.generated"

/** A highlight as the API gives it: where it is, and its quote with the text around it. */
export type ReaderHighlight = {
	id: string
	quote: string
	color: HighlightColor
	prefix?: string
	suffix?: string
	start: number
	end: number
	note?: string | null
}

export type ReaderPage = {
	title: string
	/** Site, author and reading time, already joined. */
	byline: string
	/**
	 * The posts the article was saved through (`via` in the details), shown under the byline: who
	 * shared it and what they said. Their HTML is sanitized on the server.
	 */
	via?: ReadonlyArray<{ author: string | null; siteName: string | null; html: string }>
	/**
	 * Its topics (`GET /articles/{id}/topics`): named above the title, and the shelf of what to
	 * read next after the end block. Nothing when unset (offline, or an account without topics).
	 */
	topics?: ArticleTopics | null
	/** The article's stored HTML (`GET /articles/{id}/html`), its images made local (`localImages`). */
	html: string
	highlights: ReadonlyArray<ReaderHighlight>
	/** The text size as a factor of the default (the chosen size times iOS Dynamic Type); 1 when unset. */
	fontScale?: number
	/** Sans-serif body text instead of serif. */
	sans?: boolean
	/** The saved reading position, 0–1, to open at; the top when unset. */
	position?: number
	/** A highlight to open at instead (its id), from the Highlights tab; the position when not found. */
	highlight?: string
	/**
	 * Points at the top of the screen the app's controls cover when they show: the page runs under
	 * them, so its text starts below. 0 when unset.
	 */
	top?: number
}

/**
 * The reader's page for the WebView: the web reader's type and colors (apps/web/app/app.css),
 * following the system's light or dark mode, around the article's stored HTML, as the web reader
 * shows it. The script (`src/page/reader-page.ts`, bundled) paints the highlights and reports what
 * happens; it holds no token and calls nothing. The page's policy runs only that script and loads
 * only images: the HTML is sanitized on the server, and this keeps it inert if it ever isn't.
 */
export function readerHtml(page: ReaderPage): string {
	const config: PageConfig = {
		top: topOf(page),
		highlights: pageHighlights(page.highlights),
		position: restorable(page.position),
		highlight: page.highlight ?? null,
	}
	return `<!doctype html>
<html${page.sans ? ' class="sans"' : ""}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${css}html { font-size: ${16 * clampScale(page.fontScale)}px; } :root { --top: ${topOf(page)}px; }</style>
</head>
<body>
<header>
${kickerHtml(page.topics)}<h1>${escapeHtml(page.title)}</h1>
${page.byline ? `<p class="byline">${escapeHtml(page.byline)}</p>` : ""}
${(page.via ?? []).map(viaHtml).join("")}
</header>
<article>${page.html}</article>
<section id="klip-end" data-after-reading></section>
${shelfHtml(page.topics)}<script type="application/json" id="klip-config">${scriptJson(config)}</script>
<script>${pageScript}</script>
</body>
</html>`
}

/** The article's topics above its title, strongest first, as a newspaper names its sections. */
function kickerHtml(topics: ReaderPage["topics"]): string {
	if (!topics?.topics.length) return ""
	const names = topics.topics.map((t) => `<span>${escapeHtml(t.name)}</span>`)
	return `<p class="kicker">${names.join('<span aria-hidden="true">·</span>')}</p>\n`
}

/**
 * At the end, what to read next: unread articles of its strongest topic, as the web reader's
 * shelf. Each is a link to its reader page, which the app opens as it opens the library's own
 * links. `data-after-reading`: reading progress stops above it.
 */
function shelfHtml(topics: ReaderPage["topics"]): string {
	const shelf = topics?.shelf
	if (!shelf?.items.length) return ""
	const cards = shelf.items.map((item) => {
		const site = escapeHtml(item.siteName ?? hostOf(item.url))
		const minutes = item.readingMinutes
			? `<span class="shelf-minutes">${item.readingMinutes} min</span>`
			: ""
		return `<a class="shelf-card" href="${escapeHtml(item.readerUrl)}"><span class="shelf-site">${site}</span><span class="shelf-title">${escapeHtml(item.title ?? hostOf(item.url))}</span>${minutes}</a>`
	})
	return `<section id="klip-shelf" data-after-reading><div class="shelf-head"><h2>More in ${escapeHtml(shelf.topic.name)}</h2><span class="shelf-count">${shelf.unread} unread</span></div><div class="shelf-cards">${cards.join("")}</div></section>
`
}

function hostOf(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

/** A post the article was saved through, as the web reader shows it above the article. */
function viaHtml(via: NonNullable<ReaderPage["via"]>[number]): string {
	const who = via.author ? `Shared by ${via.author}` : "Shared in a post"
	const line = [who, via.siteName].filter(Boolean).join(" · ")
	return `<aside class="via"><p class="via-by">${escapeHtml(line)}</p>${via.html}</aside>`
}

/** Only the page's own script; images from its folder and the web; styles in the page. */
const POLICY = [
	"default-src 'none'",
	`script-src '${pageScriptHash}'`,
	"style-src 'unsafe-inline'",
	"img-src file: https: data:",
	"base-uri 'none'",
	"form-action 'none'",
].join("; ")

/** JSON safe inside a script element: "<" escaped, so no text in it can close the element. */
function scriptJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c")
}

function topOf(page: ReaderPage): number {
	return Math.max(0, Math.round(page.top ?? 0))
}

function pageHighlights(highlights: ReadonlyArray<ReaderHighlight>): PageHighlight[] {
	return highlights.map((h) => ({
		id: h.id,
		color: HIGHLIGHT_COLORS.indexOf(h.color),
		quote: h.quote,
		prefix: h.prefix ?? "",
		suffix: h.suffix ?? "",
		start: h.start,
		end: h.end,
		note: Boolean(h.note?.trim()),
	}))
}

/** Highlights for `window.klipHighlights`, as the app injects them to repaint. */
export function highlightsJson(highlights: ReadonlyArray<ReaderHighlight>): string {
	return scriptJson(pageHighlights(highlights))
}

/** The article's words, for guessing its language: its HTML without tags, up to 5,000 characters. */
export function sampleText(html: string): string {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 5000)
}

/** A stored image's size in pixels, from the article's details; null when unknown. */
export type ImageSize = { width: number | null; height: number | null }

/**
 * Stored images need the app's token, which the page never gets. So their `<img>`s start empty,
 * marked with the asset id (`data-asset`); the app downloads each into the page's folder and
 * sets its `src` through `window.klipAsset(id, fileName)`. Matched by path (`/assets/<id>`), as
 * the API says clients should. Returns the ids in order, each once.
 *
 * An image whose size is known takes its place at once (as wide as it will be, and its shape), so
 * the text doesn't move as images land: opening at the saved position needs a steady page.
 */
export function localImages(
	html: string,
	sizes: ReadonlyMap<string, ImageSize> = new Map(),
): { html: string; ids: string[] } {
	const ids = new Set<string>()
	const out = html.replace(
		/<img([^>]*?)\ssrc="[^"]*\/assets\/([0-9a-f-]{36})"/g,
		(_, before: string, id: string) => {
			ids.add(id)
			const size = sizes.get(id)
			const style =
				size?.width && size.height
					? ` style="width: min(100%, ${size.width}px); aspect-ratio: ${size.width} / ${size.height}"`
					: ""
			return `<img${before} data-asset="${id}"${style}`
		},
	)
	return { html: out, ids: [...ids] }
}

/** A position worth opening at; others open at the top, as on the web. */
function restorable(position = 0): number {
	return Number.isFinite(position) && position >= 0.05 && position <= 0.95 ? position : 0
}

/** Dynamic Type goes from 0.82 (xSmall) to 3.12 (accessibility XXXL); keep the text readable. */
export function clampScale(scale = 1): number {
	return Math.min(Math.max(Number.isFinite(scale) ? scale : 1, 0.85), 2.5)
}

export function escapeHtml(text: string): string {
	return text.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
	)
}

const css = `
:root {
	color-scheme: light dark;
	--bg: oklch(0.985 0.004 85); --fg: oklch(0.23 0.012 260); --muted-fg: oklch(0.5 0.014 260);
	--muted: oklch(0.955 0.006 90); --border: oklch(0.9 0.008 90); --link: oklch(0.48 0.16 257);
	/* The highlights' marker inks and solid lines, by index in HIGHLIGHT_COLORS: the web's --hl-*. */
	--hl-0: oklch(0.92 0.16 99); --hl-1: oklch(0.89 0.12 152); --hl-2: oklch(0.87 0.08 232);
	--hl-3: oklch(0.87 0.09 355); --hl-4: oklch(0.87 0.11 62);
	--hl-0-solid: oklch(0.9 0.17 95); --hl-1-solid: oklch(0.8 0.15 150);
	--hl-2-solid: oklch(0.75 0.12 240); --hl-3-solid: oklch(0.76 0.14 355);
	--hl-4-solid: oklch(0.79 0.15 60);
	/* Where two strokes cross: the inks mixed, and deeper. */
	--hl-deepen: oklch(0.25 0.03 60) 15%;
	--speaking: oklch(0.48 0.16 257 / 0.13);
	--accent: oklch(0.37 0.085 260); --accent-fg: oklch(0.99 0 0); --favorite: oklch(0.58 0.12 78);
	--note: oklch(0.955 0.065 96); --note-fg: oklch(0.27 0.03 75); --note-tape: oklch(1 0 0 / 0.55);
	--serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
	--sans: ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
	:root {
		/* The same paper under a reading lamp: warm greys rather than blue ones, as the web's. */
		--bg: oklch(0.2 0.011 65); --fg: oklch(0.92 0.014 85); --muted-fg: oklch(0.72 0.018 75);
		--muted: oklch(0.26 0.013 65); --border: oklch(0.33 0.015 65); --link: oklch(0.78 0.105 250);
		--hl-0: oklch(0.5 0.1 95); --hl-1: oklch(0.46 0.1 152); --hl-2: oklch(0.46 0.11 248);
		--hl-3: oklch(0.47 0.12 355); --hl-4: oklch(0.5 0.12 55);
		--hl-1-solid: oklch(0.82 0.15 150); --hl-2-solid: oklch(0.78 0.12 240);
		--hl-3-solid: oklch(0.79 0.13 355); --hl-4-solid: oklch(0.82 0.14 60);
		--hl-deepen: oklch(0.95 0.02 90) 8%;
		--speaking: oklch(0.78 0.105 250 / 0.2);
		--accent: oklch(0.74 0.1 255); --accent-fg: oklch(0.2 0.02 65); --favorite: oklch(0.78 0.12 80);
		--note: oklch(0.4 0.05 85); --note-fg: oklch(0.95 0.025 90); --note-tape: oklch(1 0 0 / 0.15);
	}
}
html { -webkit-text-size-adjust: 100%; }
html.sans body { font-family: var(--sans); }
body {
	margin: 0 auto; max-width: 42rem;
	/* Room for the controls at the top, and for the status line at the bottom. */
	padding: calc(16px + var(--top, 0px)) 20px calc(56px + env(safe-area-inset-bottom));
	background: var(--bg); color: var(--fg);
	font-family: var(--serif); font-size: 1.1875rem; line-height: 1.65;
	hyphens: auto; -webkit-hyphens: auto; overflow-wrap: break-word;
}
header h1 { font-family: var(--sans); font-size: 1.875rem; line-height: 1.2; margin: 8px 0 8px; }
.byline { font-family: var(--sans); font-size: 0.9375rem; color: var(--muted-fg); margin: 0 0 24px; }
.via { font-family: var(--sans); font-size: 0.9375rem; line-height: 1.5; margin: -8px 0 24px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px; }
.via p, .via blockquote { margin: 0 0 0.5em; }
.via > :last-child { margin-bottom: 0; }
.via .via-by { font-size: 0.8125rem; color: var(--muted-fg); margin-bottom: 4px; }
h2, h3, h4, h5, h6 { font-family: var(--sans); line-height: 1.3; margin: 1.6em 0 0.6em; }
h2 { font-size: 1.3em; } h3 { font-size: 1.15em; } h4, h5, h6 { font-size: 1em; }
p, ul, ol, blockquote, pre, figure, table { margin: 0 0 1.1em; }
a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 2px; }
img { display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: 8px; }
figure { margin-inline: 0; }
figcaption { font-family: var(--sans); font-size: 0.875rem; color: var(--muted-fg); margin-top: 6px; }
blockquote { margin-inline: 0; padding-left: 16px; border-left: 3px solid var(--border); }
/* Translucent: a highlight's ink lies under the text, and shows through. */
pre { background: color-mix(in oklch, var(--muted) 50%, transparent); padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 0.85em; }
code { font-size: 0.9em; }
pre code { font-size: inherit; }
table { display: block; overflow-x: auto; border-collapse: collapse; font-size: 0.9em; }
th, td { border: 1px solid var(--border); padding: 6px 10px; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
img[data-asset]:not([src]) { width: 100%; aspect-ratio: 3 / 2; background: var(--muted); }
/* The highlights: marker strokes under the text (src/page/ink.ts, as the web's .hl-ink), one per
   line, 80% as tall as the text and low in it; the pen lands a little early and lifts a little
   late, and pools at both ends. The layer lies behind the article's text: the letters keep their
   full strength. Where two cross, the ink is deeper, drawn as a piece of its own (.hl-cross), as
   blend modes composite slowly in WebKit. */
:is(.hl-ink, .hl-tab, .hl-layer, .hl-pop)[data-color="0"] { --hl: var(--hl-0); --hl-solid: var(--hl-0-solid); }
:is(.hl-ink, .hl-tab, .hl-layer, .hl-pop)[data-color="1"] { --hl: var(--hl-1); --hl-solid: var(--hl-1-solid); }
:is(.hl-ink, .hl-tab, .hl-layer, .hl-pop)[data-color="2"] { --hl: var(--hl-2); --hl-solid: var(--hl-2-solid); }
:is(.hl-ink, .hl-tab, .hl-layer, .hl-pop)[data-color="3"] { --hl: var(--hl-3); --hl-solid: var(--hl-3-solid); }
:is(.hl-ink, .hl-tab, .hl-layer, .hl-pop)[data-color="4"] { --hl: var(--hl-4); --hl-solid: var(--hl-4-solid); }
.hl-inks { position: absolute; top: 0; left: 0; z-index: -1; pointer-events: none; }
.hl-ink {
	position: absolute;
	background: linear-gradient(90deg, color-mix(in oklch, var(--hl), var(--fg) 9%), var(--hl) 0.6em calc(100% - 0.8em), color-mix(in oklch, var(--hl), var(--fg) 6%));
}
.hl-cross {
	position: absolute; border-radius: 0.25em;
	background: color-mix(in oklch, color-mix(in oklch, var(--a), var(--b)), var(--hl-deepen));
}
/* A highlight just made is drawn in, once, line after line; right-to-left text from the right. */
.hl-ink[data-fresh] { animation: ink-in 0.32s cubic-bezier(0.3, 0.7, 0.2, 1) both; }
.hl-ink[data-fresh][data-rtl] { animation-name: ink-in-rtl; }
@keyframes ink-in { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes ink-in-rtl { from { clip-path: inset(0 0 0 100%); } to { clip-path: inset(0 0 0 0); } }
@media (prefers-reduced-motion: reduce) { .hl-ink[data-fresh], .hl-ink[data-fresh][data-rtl] { animation: none; } }
/* A highlight with a note: a tab of its color at the right of its first line, past the text, like a
   sticky tab poking out of a book. A finger wide to tap, though it shows small, and within the
   page's margin: nothing past the screen's edge. */
.hl-tabs { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }
.hl-tab {
	position: absolute; width: 36px; margin-left: -16px; pointer-events: auto;
	-webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none;
}
.hl-tab::after {
	content: ""; position: absolute; left: 19px; top: 12%; bottom: 12%; width: 9px;
	border-radius: 1px 4px 4px 1px; background: var(--hl-solid);
	box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);
}
/* A highlight's card is open: the text and the other highlights fade; it shows at full strength,
   with full-strength text, and a line of its color around each stroke (.hl-pop). As the web reader. */
article[data-focus], article[data-focus] * { color: color-mix(in oklch, var(--fg) 55%, transparent); text-decoration-color: currentColor; }
article[data-focus] ::highlight(klip-active) { color: var(--fg); }
.hl-inks[data-focus] > :is(.hl-ink, .hl-cross):not([data-active]),
.hl-tabs[data-focus] > :not([data-active]) { opacity: 0.3; }
/* Over the tabs: a handle at the end of a line with a note's tab is the handle. */
.hl-layer { position: absolute; top: 0; left: 0; z-index: 2; pointer-events: none; }
.hl-pop {
	position: absolute; border-radius: 3px;
	box-shadow: 0 0 0 1.5px var(--hl-solid), 0 3px 8px -3px oklch(0.2 0.05 262 / 0.35);
}
/* Its ends' handles: a bar the height of the line, with a knob above the start and below the end;
   each a finger wide, and taller than its line. */
.hl-handle {
	position: absolute; width: 44px; margin: -14px 0 0 -22px; padding: 14px 0;
	pointer-events: auto; touch-action: none; -webkit-user-select: none; -webkit-touch-callout: none;
	--handle: color-mix(in oklch, var(--hl-solid) 65%, var(--fg));
}
.hl-handle::before { content: ""; position: absolute; left: 21px; width: 2px; top: 14px; bottom: 14px; background: var(--handle); border-radius: 1px; }
.hl-handle::after { content: ""; position: absolute; left: 17px; width: 10px; height: 10px; border-radius: 50%; background: var(--handle); }
.hl-start::after { top: 5px; }
.hl-end::after { bottom: 5px; }
html.hl-dragging, html.hl-dragging * { -webkit-user-select: none; user-select: none; }
.hl-in { animation: hl-pop 0.16s ease-out; }
@keyframes hl-pop { from { opacity: 0; transform: translateY(1px); } }
@media (prefers-reduced-motion: reduce) { .hl-in { animation: none; } }
/* The end of the article (src/page/reader-page.ts, endParts): as the web reader's. */
#klip-end:empty { display: none; }
#klip-end {
	margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border);
	display: grid; gap: 14px; font-family: var(--sans); font-size: 0.9375rem; line-height: 1.4;
	-webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
}
#klip-end button { font: inherit; color: inherit; border: 0; background: none; padding: 0; cursor: pointer; }
#klip-end svg { width: 18px; height: 18px; flex: none; }
.end-part { display: contents; }
.end-status { margin: 0; color: var(--muted-fg); }
.end-heading { color: var(--fg); font-weight: 600; }
.end-check { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: var(--accent-fg); }
.end-check svg { width: 14px; height: 14px; }
.end-status .end-check { display: inline-grid; vertical-align: -6px; margin-right: 8px; }
#klip-end .end-link { color: var(--fg); font-weight: 600; text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px; }
#klip-end .end-finish {
	justify-self: start; display: inline-flex; align-items: center; gap: 8px;
	padding: 10px 18px; border-radius: 999px; background: var(--accent); color: var(--accent-fg); font-weight: 600;
}
.end-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#klip-end .end-choice {
	display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px;
	padding: 10px 8px; border-radius: 14px; background: var(--muted);
}
.end-choice.wide { grid-column: 1 / -1; }
.end-choice svg { fill: none; color: var(--muted-fg); }
.end-choice.starred svg { fill: var(--favorite); color: var(--favorite); }
/* Chosen: the navy of actions, as the web's end of an article, not a blue tint. */
#klip-end .end-choice.on { background: var(--accent); color: var(--accent-fg); }
.end-choice.on svg { color: currentColor; }
/* Marked: the note for the edition's readers, which the app's sheet edits. */
.end-edition {
	display: grid; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 14px;
	scroll-margin-bottom: 24px;
}
.end-edition-title { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.end-edition .end-check { width: 20px; height: 20px; }
.end-edition .end-check svg { width: 12px; height: 12px; }
#klip-end .end-edition-note {
	display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; overflow: hidden;
	min-height: 84px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px;
	background: var(--bg); text-align: left; white-space: pre-wrap; overflow-wrap: anywhere;
}
#klip-end .end-edition-note.empty { color: var(--muted-fg); }
.end-edition-label { margin-bottom: -6px; font-size: 0.8125rem; color: var(--muted-fg); }
/* The article note, on a post-it (src/page/takeaway.ts): the web's PostIt, \`full\`. */
.takeaway { display: grid; gap: 10px; justify-items: start; margin: 6px 0 4px; }
.takeaway-label { margin-bottom: 8px; }
.takeaway-label { font-size: 0.8125rem; font-weight: 600; color: var(--muted-fg); }
.takeaway-label span { font-weight: 400; }
.post-it {
	position: relative; box-sizing: border-box; padding: 24px 20px 20px; transform: rotate(-1deg);
	background: var(--note); color: var(--note-fg);
	box-shadow: 0 1px 1px rgb(0 0 0 / 0.08), 0 12px 24px -12px rgb(0 0 0 / 0.4);
}
.post-it .tape {
	position: absolute; top: -12px; left: 50%; width: 80px; height: 24px; pointer-events: none;
	transform: translateX(-50%) rotate(-3deg); background: var(--note-tape); box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
}
.takeaway-field {
	position: relative; min-height: 100%; outline: none; white-space: pre-wrap; overflow-wrap: anywhere;
	font-family: var(--serif); font-style: italic; font-size: 1.0625rem; line-height: 1.45;
	-webkit-user-select: text; user-select: text; caret-color: currentColor;
}
.takeaway-field.empty::before {
	content: attr(data-placeholder); position: absolute; inset: 0; pointer-events: none;
	color: color-mix(in oklch, var(--note-fg) 55%, transparent);
}
.takeaway-link { text-decoration: underline; text-underline-offset: 3px; }
.takeaway-link.trash { text-decoration: line-through; opacity: 0.6; }
.takeaway-link.missing { opacity: 0.6; }
.takeaway-status { min-height: 1.2em; font-size: 0.8125rem; color: var(--muted-fg); }
/* The topics above the title, and the shelf after the end block: as the web reader's. */
.kicker {
	display: flex; flex-wrap: wrap; gap: 0 8px; margin: 8px 0 0; font-family: var(--sans);
	font-size: 0.75rem; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase;
	color: var(--accent); line-height: 1.5;
}
#klip-shelf {
	margin-top: 40px; font-family: var(--sans); line-height: 1.4;
	-webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
}
.shelf-head { display: grid; gap: 2px; margin-bottom: 12px; }
.shelf-head h2 { margin: 0; font-size: 1rem; font-weight: 600; }
.shelf-count { font-size: 0.875rem; color: var(--muted-fg); }
.shelf-cards {
	display: flex; gap: 10px; margin: 0 -20px; padding: 0 20px 4px; overflow-x: auto;
	scroll-snap-type: x mandatory; scroll-padding: 0 20px; scrollbar-width: none;
}
.shelf-cards::-webkit-scrollbar { display: none; }
#klip-shelf .shelf-card {
	flex: none; width: 72%; scroll-snap-align: start; display: grid; align-content: start; gap: 6px;
	min-height: 128px; padding: 12px 14px; border-radius: 12px; background: var(--muted);
	color: var(--fg); text-decoration: none;
}
.shelf-site {
	overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.75rem;
	letter-spacing: 0.03em; text-transform: uppercase; color: var(--muted-fg);
}
.shelf-title {
	display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden;
	font-family: var(--serif); font-size: 1rem; font-weight: 700; line-height: 1.35; hyphens: manual; -webkit-hyphens: manual;
}
.shelf-minutes { margin-top: auto; font-size: 0.75rem; color: var(--muted-fg); }
/* The sentence being read aloud. */
::highlight(klip-speaking) { background-color: var(--speaking); }
/* A followed citation's passage flashes in the citation's own ink, the highlighter's yellow, and
   fades out in steps (\`klipCite\`): a ::highlight can't be animated. */
/* AI threads: a solid accent line under the passage; the open one's gets a faint accent wash. */
::highlight(klip-ai) {
	text-decoration: underline solid color-mix(in oklch, var(--accent) 70%, transparent);
	text-decoration-thickness: 1.5px; text-underline-offset: 4px;
}
::highlight(klip-ai-focus) { background-color: color-mix(in oklch, var(--accent) 14%, transparent); }
::highlight(klip-cited) { background-color: color-mix(in oklch, var(--hl-0) 85%, transparent); }
::highlight(klip-cited-fading) { background-color: color-mix(in oklch, var(--hl-0) 40%, transparent); }
`
