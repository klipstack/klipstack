/**
 * A range's text as the page shows it: paragraphs a blank line apart, a line break where the page
 * breaks one, a space where the source only wrapped its line. A highlight's stored `exact` is the
 * source's text, line breaks and all, with nothing between one paragraph and the next.
 */
export function rangeText(range: Range): string {
	const box = document.createElement("div")
	box.append(range.cloneContents())
	// `innerText` follows the white-space rules only on an element that is in the document.
	box.style.cssText =
		"position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none"
	box.setAttribute("aria-hidden", "true")
	document.body.append(box)
	try {
		return box.innerText
	} finally {
		box.remove()
	}
}
