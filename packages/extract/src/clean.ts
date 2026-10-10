import { JSDOM } from "jsdom"

export interface CleanOptions {
	url: string
	title: string | null
	/** Drop link-heavy blocks at the edges. Off for content we built ourselves (a tweet can be one link). */
	trimEdges?: boolean
}

const REMOVE_SELECTOR = [
	"script",
	"style",
	"noscript",
	"iframe",
	"form",
	"input",
	"button",
	"select",
	"textarea",
	"link",
	"meta",
	"template",
	"object",
	"embed",
	"svg",
	"canvas",
	"video",
	"audio",
	"map",
	"area",
	"dialog",
].join(",")

const LAZY_SRC_ATTRS = [
	"data-src",
	"data-lazy-src",
	"data-original",
	"data-url",
	"data-hi-res-src",
	"data-orig-file",
	"data-large-file",
]
const LAZY_SRCSET_ATTRS = ["data-srcset", "data-lazy-srcset"]

function isPlaceholderSrc(src: string | null): boolean {
	if (!src) return true
	const s = src.trim()
	return (
		s === "" ||
		s.startsWith("data:") ||
		/\/(blank|placeholder|spacer|pixel|lazy|loading)[^/]*\.(gif|png|svg)/i.test(s) ||
		/^about:blank$/i.test(s)
	)
}

function absolutize(el: Element, attr: string, base: string) {
	const v = el.getAttribute(attr)
	if (!v) return
	try {
		const abs = new URL(v.trim(), base)
		if (abs.protocol === "http:" || abs.protocol === "https:") el.setAttribute(attr, abs.toString())
		else if (attr === "href" && (abs.protocol === "mailto:" || v.trim().startsWith("#"))) return
		else el.removeAttribute(attr)
	} catch {
		el.removeAttribute(attr)
	}
}

function absolutizeSrcset(el: Element, attr: string, base: string) {
	const v = el.getAttribute(attr)
	if (!v) return
	const parts = v
		.split(",")
		.map((c) => c.trim())
		.filter(Boolean)
		.map((candidate) => {
			const [u, ...rest] = candidate.split(/\s+/)
			try {
				const abs = new URL(u as string, base)
				if (abs.protocol !== "http:" && abs.protocol !== "https:") return null
				return [abs.toString(), ...rest].join(" ")
			} catch {
				return null
			}
		})
		.filter((c): c is string => Boolean(c))
	if (parts.length) el.setAttribute(attr, parts.join(", "))
	else el.removeAttribute(attr)
}

function textOf(el: Element | null): string {
	return (el?.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase()
}

function linkTextLength(el: Element): number {
	let n = 0
	for (const a of Array.from(el.querySelectorAll("a")))
		n += (a.textContent ?? "").replace(/\s+/g, " ").trim().length
	return n
}

function textLength(el: Element): number {
	return (el.textContent ?? "").replace(/\s+/g, " ").trim().length
}

/**
 * Old-school layout tables: one row (or very few) where a single cell holds nearly all the text
 * and the other cells are navigation (link-dominated) or empty. Replace the table with the
 * dominant cell's content. Data tables have many rows with text spread across cells and are
 * left alone.
 */
function unwrapLayoutTables(root: HTMLElement) {
	for (let pass = 0; pass < 3; pass++) {
		let changed = false
		for (const table of Array.from(root.querySelectorAll("table"))) {
			const rows = table.querySelectorAll("tr")
			if (rows.length === 0 || rows.length > 3) continue
			const cells = Array.from(table.querySelectorAll("td, th"))
			if (cells.length < 2) continue
			const total = textLength(table)
			if (total < 400) continue
			const dominant = cells.reduce((a, b) => (textLength(b) > textLength(a) ? b : a))
			const dominantLen = textLength(dominant)
			if (dominantLen < total * 0.8) continue
			const others = cells.filter(
				(c) => c !== dominant && !c.contains(dominant) && !dominant.contains(c),
			)
			const othersNav = others.every((c) => {
				const len = textLength(c)
				return len === 0 || len < total * 0.1 || linkTextLength(c) >= len * 0.5
			})
			if (!othersNav) continue
			const doc = table.ownerDocument
			const wrapper = doc.createElement("div")
			wrapper.append(...Array.from(dominant.childNodes))
			table.replaceWith(wrapper)
			changed = true
		}
		if (!changed) break
	}
}

/**
 * Drop navigation-like blocks at the very start and end of the article: short, link-dominated
 * paragraphs/lists that extractors sometimes leave attached (menus, "related" lists, footers).
 */
function trimBoilerplateEdges(root: HTMLElement) {
	const isNavBlock = (el: Element) => {
		const len = textLength(el)
		if (len === 0) return true
		if (/^(NAV|HEADER|FOOTER|ASIDE)$/.test(el.tagName)) return true
		return len < 200 && linkTextLength(el) >= len * 0.5
	}
	const isProse = (el: Element) => textLength(el) >= 60 && linkTextLength(el) < textLength(el) * 0.3
	for (const side of ["first", "last"] as const) {
		for (let i = 0; i < 12; i++) {
			const el = side === "first" ? root.firstElementChild : root.lastElementChild
			if (!el || isProse(el) || el.querySelector("img, pre, table, blockquote")) break
			if (!isNavBlock(el)) break
			el.remove()
		}
	}
}

/**
 * Normalize extracted article HTML before sanitizing: absolute URLs, lazy images resolved,
 * junk removed, headings demoted, duplicate title header dropped, attributes trimmed.
 */
export function cleanArticleHtml(
	contentHtml: string,
	{ url, title, trimEdges = true }: CleanOptions,
): string {
	const dom = new JSDOM(
		`<!doctype html><html><head><base href="${url.replace(/"/g, "&quot;")}"></head><body><div id="root">${contentHtml}</div></body></html>`,
		{ url },
	)
	const doc = dom.window.document
	let root = doc.getElementById("root") as HTMLElement

	for (const el of Array.from(root.querySelectorAll(REMOVE_SELECTOR))) el.remove()

	// Unwrap single wrapper chains and a lone <article>.
	while (
		root.children.length === 1 &&
		root.childNodes.length === 1 &&
		/^(DIV|ARTICLE|SECTION|MAIN)$/.test((root.firstElementChild as Element).tagName)
	) {
		root = root.firstElementChild as HTMLElement
	}
	const article = root.querySelector("article")
	if (article && textOf(article).length > textOf(root).length * 0.8) root = article as HTMLElement

	unwrapLayoutTables(root)

	// Images: lazy attributes, placeholders, tracking pixels, absolute URLs, safe loading attrs.
	for (const img of Array.from(root.querySelectorAll("img"))) {
		if (isPlaceholderSrc(img.getAttribute("src"))) {
			for (const attr of LAZY_SRC_ATTRS) {
				const v = img.getAttribute(attr)
				if (v && !isPlaceholderSrc(v)) {
					img.setAttribute("src", v)
					break
				}
			}
		}
		if (!img.getAttribute("srcset")) {
			for (const attr of LAZY_SRCSET_ATTRS) {
				const v = img.getAttribute(attr)
				if (v) {
					img.setAttribute("srcset", v)
					break
				}
			}
		}
		if (!img.getAttribute("src") && img.getAttribute("srcset")) {
			const first = img.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0]
			if (first) img.setAttribute("src", first)
		}
		const w = Number(img.getAttribute("width") ?? 0)
		const h = Number(img.getAttribute("height") ?? 0)
		if (isPlaceholderSrc(img.getAttribute("src")) || (w > 0 && w <= 2) || (h > 0 && h <= 2)) {
			img.remove()
			continue
		}
		absolutize(img, "src", url)
		absolutizeSrcset(img, "srcset", url)
		if (!img.getAttribute("src")) {
			img.remove()
			continue
		}
		img.setAttribute("loading", "lazy")
		img.setAttribute("decoding", "async")
		img.setAttribute("referrerpolicy", "no-referrer")
		for (const attr of Array.from(img.attributes)) {
			if (
				attr.name.startsWith("data-") ||
				attr.name === "class" ||
				attr.name === "style" ||
				attr.name === "id"
			)
				img.removeAttribute(attr.name)
		}
	}
	for (const source of Array.from(root.querySelectorAll("source"))) {
		absolutizeSrcset(source, "srcset", url)
		absolutize(source, "src", url)
	}
	for (const pic of Array.from(root.querySelectorAll("picture"))) {
		if (!pic.querySelector("img")) pic.remove()
	}

	// Links: keep in-page anchors, open external links in a new tab.
	for (const a of Array.from(root.querySelectorAll("a"))) {
		const href = a.getAttribute("href")?.trim() ?? ""
		if (!href) {
			a.replaceWith(...Array.from(a.childNodes))
			continue
		}
		let isInPage = href.startsWith("#")
		if (!isInPage) {
			try {
				const abs = new URL(href, url)
				const page = new URL(url)
				if (
					abs.hash &&
					abs.origin === page.origin &&
					abs.pathname === page.pathname &&
					abs.search === page.search
				) {
					a.setAttribute("href", abs.hash)
					isInPage = true
				}
			} catch {
				// handled by absolutize
			}
		}
		if (!isInPage) {
			absolutize(a, "href", url)
			if (a.getAttribute("href")) {
				a.setAttribute("target", "_blank")
				a.setAttribute("rel", "noopener noreferrer")
			} else {
				a.replaceWith(...Array.from(a.childNodes))
				continue
			}
		}
		for (const attr of Array.from(a.attributes)) {
			if (!["href", "target", "rel", "id", "title", "lang", "dir"].includes(attr.name))
				a.removeAttribute(attr.name)
		}
	}

	// Drop a leading header/heading that duplicates the title.
	if (title) {
		const t = title.replace(/\s+/g, " ").trim().toLowerCase()
		const first = root.firstElementChild
		if (first) {
			const isHeadingLike = /^(H1|H2|HEADER)$/.test(first.tagName)
			const heading = first.tagName === "HEADER" ? first.querySelector("h1,h2,h3") : first
			const ht = textOf(heading)
			if (isHeadingLike && ht && (ht === t || t.includes(ht) || ht.includes(t))) first.remove()
		}
		for (const h1 of Array.from(root.querySelectorAll("h1"))) {
			if (textOf(h1) === t) h1.remove()
		}
	}

	// Demote headings so the article title is the only h1 on the page.
	if (root.querySelector("h1")) {
		for (const level of [5, 4, 3, 2, 1]) {
			for (const h of Array.from(root.querySelectorAll(`h${level}`))) {
				const nh = doc.createElement(`h${level + 1}`)
				for (const attr of Array.from(h.attributes)) nh.setAttribute(attr.name, attr.value)
				nh.append(...Array.from(h.childNodes))
				h.replaceWith(nh)
			}
		}
	}
	for (const h of Array.from(root.querySelectorAll("h7"))) {
		const strong = doc.createElement("p")
		const b = doc.createElement("strong")
		b.append(...Array.from(h.childNodes))
		strong.append(b)
		h.replaceWith(strong)
	}

	// Attributes: keep ids (footnote anchors), language classes on code, drop the rest.
	for (const el of Array.from(root.querySelectorAll("*"))) {
		for (const attr of Array.from(el.attributes)) {
			const n = attr.name
			if (
				n === "style" ||
				n.startsWith("on") ||
				n.startsWith("aria-") ||
				n === "role" ||
				n === "tabindex"
			)
				el.removeAttribute(n)
			else if (n === "class") {
				const keep = attr.value
					.split(/\s+/)
					.filter((c) => /^(language-|lang-|hljs)/.test(c))
					.join(" ")
				if (keep && /^(PRE|CODE)$/.test(el.tagName)) el.setAttribute("class", keep)
				else el.removeAttribute("class")
			} else if (n.startsWith("data-") && n !== "data-original-src") el.removeAttribute(n)
		}
	}

	// Remove empty blocks (no text, no image, no hr/br-only content).
	let removed = true
	while (removed) {
		removed = false
		for (const el of Array.from(
			root.querySelectorAll(
				"p, div, section, span, li, ul, ol, blockquote, figure, header, footer, aside, article",
			),
		)) {
			if (el.querySelector("img, picture, table, pre, hr, math")) continue
			if ((el.textContent ?? "").replace(/[\s ]+/g, "") === "") {
				el.remove()
				removed = true
			}
		}
	}

	if (trimEdges) trimBoilerplateEdges(root)

	// Trim leading/trailing <br> and <hr>.
	while (root.firstElementChild && /^(BR|HR)$/.test(root.firstElementChild.tagName))
		root.firstElementChild.remove()
	while (root.lastElementChild && /^(BR|HR)$/.test(root.lastElementChild.tagName))
		root.lastElementChild.remove()

	return root.innerHTML.trim()
}
