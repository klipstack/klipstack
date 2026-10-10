/**
 * The web address in what was typed or pasted, to save: the first http(s) link in it, without the
 * punctuation that ends a sentence around it; or, when the text is only an address without its
 * scheme ("example.com/page"), that address over https. Null when there is none.
 */
export function linkIn(text: string): string | null {
	const found = /https?:\/\/[^\s<>"“”«»]+/i.exec(text)
	if (found) return trimEnd(found[0])
	const bare = text.trim()
	if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(bare)) return `https://${bare}`
	return null
}

/** Drops closing punctuation; a bracket only when the link doesn't open it (…/Foo_(bar)). */
function trimEnd(link: string): string {
	let out = link
	for (;;) {
		const last = out.slice(-1)
		if (/[.,;:!?'’]/.test(last)) out = out.slice(0, -1)
		else if (last === ")" && count(out, ")") > count(out, "(")) out = out.slice(0, -1)
		else if (last === "]" && count(out, "]") > count(out, "[")) out = out.slice(0, -1)
		else return out
	}
}

function count(text: string, char: string): number {
	return text.split(char).length - 1
}
