import createDOMPurify from "dompurify"
import { JSDOM } from "jsdom"

const ALLOWED_TAGS = [
	"a",
	"abbr",
	"address",
	"article",
	"aside",
	"b",
	"bdi",
	"bdo",
	"blockquote",
	"br",
	"caption",
	"cite",
	"code",
	"col",
	"colgroup",
	"dd",
	"del",
	"details",
	"dfn",
	"div",
	"dl",
	"dt",
	"em",
	"figcaption",
	"figure",
	"footer",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"i",
	"img",
	"ins",
	"kbd",
	"li",
	"main",
	"mark",
	"ol",
	"p",
	"picture",
	"pre",
	"q",
	"rp",
	"rt",
	"ruby",
	"s",
	"samp",
	"section",
	"small",
	"source",
	"span",
	"strong",
	"sub",
	"summary",
	"sup",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"time",
	"tr",
	"u",
	"ul",
	"var",
	"wbr",
	// MathML
	"math",
	"mi",
	"mn",
	"mo",
	"mrow",
	"msup",
	"msub",
	"msubsup",
	"mfrac",
	"msqrt",
	"mroot",
	"mtext",
	"mspace",
	"mtable",
	"mtr",
	"mtd",
	"munder",
	"mover",
	"munderover",
	"semantics",
	"annotation",
	"mstyle",
	"mpadded",
	"mphantom",
	"menclose",
	"ms",
	"mmultiscripts",
	"mprescripts",
]

/**
 * Never allowed, whatever the list above says. `clean.ts` removes most of these before this runs;
 * this is the second line, so a caller that skips cleaning still gets no forms, styles or embeds.
 */
const FORBID_TAGS = [
	"script",
	"style",
	"link",
	"meta",
	"base",
	"form",
	"input",
	"button",
	"select",
	"option",
	"textarea",
	"iframe",
	"frame",
	"object",
	"embed",
	"svg",
	"template",
	"dialog",
]

const ALLOWED_ATTR = [
	"href",
	"src",
	"srcset",
	"sizes",
	"alt",
	"title",
	"width",
	"height",
	"loading",
	"decoding",
	"referrerpolicy",
	"target",
	"rel",
	"id",
	"lang",
	"dir",
	"colspan",
	"rowspan",
	"scope",
	"datetime",
	"cite",
	"start",
	"reversed",
	"type",
	"class",
	"open",
	"media",
	"data-original-src",
	"data-lang",
	// MathML
	"display",
	"mathvariant",
	"xmlns",
	"displaystyle",
	"scriptlevel",
	"stretchy",
	"fence",
	"separator",
	"accent",
	"accentunder",
	"movablelimits",
	"largeop",
	"symmetric",
	"lspace",
	"rspace",
	"minsize",
	"maxsize",
	"form",
	"linethickness",
	"columnalign",
	"rowalign",
	"columnspacing",
	"rowspacing",
	"notation",
	"depth",
	"voffset",
	"encoding",
]

let purify: ReturnType<typeof createDOMPurify> | undefined

function getPurify() {
	if (!purify) {
		purify = createDOMPurify(new JSDOM("").window)
		// Only http(s), mailto and in-page anchors survive on href/src; anything else is dropped.
		purify.addHook("uponSanitizeAttribute", (_node, data) => {
			if (data.attrName === "href" || data.attrName === "src") {
				const v = data.attrValue.trim()
				const ok = /^(https?:|mailto:|#)/i.test(v)
				if (!ok) data.keepAttr = false
			}
			if (data.attrName === "srcset" && /\bdata:|javascript:/i.test(data.attrValue))
				data.keepAttr = false
			if (data.attrName === "target" && data.attrValue !== "_blank") data.keepAttr = false
			// Images never tell a site which article showed them.
			if (data.attrName === "referrerpolicy" && data.attrValue !== "no-referrer")
				data.keepAttr = false
			// Only the code highlighter's classes, one by one: the app's own (Tailwind) classes on
			// article markup could cover the page.
			if (data.attrName === "class") {
				const kept = data.attrValue
					.split(/\s+/)
					.filter((name) => /^(language-|lang-|hljs)/.test(name))
					.join(" ")
				if (kept) data.attrValue = kept
				else data.keepAttr = false
			}
		})
		purify.addHook("afterSanitizeAttributes", (node) => {
			if (node.tagName === "A" && node.getAttribute("target") === "_blank")
				node.setAttribute("rel", "noopener noreferrer")
			if (node.tagName === "IMG" && !node.getAttribute("src")) node.remove()
		})
	}
	return purify
}

/**
 * Sanitize article HTML for storage. Output is what the reader renders verbatim, inside the app's
 * own page. The lists above are the whole policy: DOMPurify's `USE_PROFILES` would replace them
 * with its full HTML profile (forms, styles, `background`), so it must not be set here.
 */
export function sanitizeHtml(html: string): string {
	return getPurify().sanitize(html, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		FORBID_TAGS,
		FORBID_ATTR: ["style", "background", "ping", "formaction", "srcdoc"],
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
		KEEP_CONTENT: true,
		WHOLE_DOCUMENT: false,
	}) as string
}
