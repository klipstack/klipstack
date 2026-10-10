import { createRequire } from "node:module"
import type TurndownService from "turndown"

// Turndown's ESM build reaches for `require` at runtime (to load its Node DOM parser), which
// breaks under Vite's SSR module runner. Load the CJS build explicitly instead.
const Turndown = createRequire(import.meta.url)("turndown") as typeof TurndownService

let turndown: TurndownService | undefined

/**
 * A URL as a Markdown link destination, read whole: an unescaped ")" would end it early and turn
 * the rest into Markdown ("https://x/a)[Tap](javascript:…)" into a second link).
 */
function destination(url: string): string {
	return url.replace(/[\\<>()]/g, "\\$&").replace(/\s/g, encodeURIComponent)
}

function getTurndown() {
	if (!turndown) {
		turndown = new Turndown({
			headingStyle: "atx",
			codeBlockStyle: "fenced",
			bulletListMarker: "-",
			emDelimiter: "_",
		})
		// Turndown leaves text that a Markdown renderer reads as HTML: a tag, comment or autolink
		// ("<marquee>" in a post about that tag) and a character reference ("&copy;").
		const escape = turndown.escape.bind(turndown)
		turndown.escape = (text) => escape(text).replace(/<(?=[A-Za-z/!?])|&(?=#?\w+;)/g, "\\$&")
		turndown.addRule("figure", {
			filter: "figure",
			replacement: (_content, node) => {
				const el = node as HTMLElement
				const img = el.querySelector("img")
				const captionText = el.querySelector("figcaption")?.textContent?.trim()
				const caption = captionText && getTurndown().escape(captionText)
				if (!img) return caption ? `\n\n_${caption}_\n\n` : ""
				const src = img.getAttribute("data-original-src") ?? img.getAttribute("src") ?? ""
				const alt = (img.getAttribute("alt") ?? captionText ?? "").replace(/\]/g, "")
				return `\n\n![${alt}](${destination(src)})${caption ? `\n\n_${caption}_` : ""}\n\n`
			},
		})
		turndown.addRule("img", {
			filter: "img",
			replacement: (_content, node) => {
				const el = node as HTMLElement
				const src = el.getAttribute("data-original-src") ?? el.getAttribute("src") ?? ""
				const alt = (el.getAttribute("alt") ?? "").replace(/\]/g, "")
				return src ? `![${alt}](${destination(src)})` : ""
			},
		})
		turndown.addRule("preCode", {
			filter: (node) => node.nodeName === "PRE",
			replacement: (_content, node) => {
				const el = node as HTMLElement
				const code = el.querySelector("code")
				const lang =
					/language-([\w-]+)/.exec(
						code?.getAttribute("class") ?? el.getAttribute("class") ?? "",
					)?.[1] ?? ""
				const text = (code ?? el).textContent ?? ""
				return `\n\n\`\`\`${lang}\n${text.replace(/\n$/, "")}\n\`\`\`\n\n`
			},
		})
	}
	return turndown
}

/** Markdown rendition of sanitized article HTML (exports, agents). Not stored. */
export function htmlToMarkdown(html: string): string {
	return getTurndown()
		.turndown(html)
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}
