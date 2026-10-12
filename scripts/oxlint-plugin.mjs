// Klipstack's own oxlint rules (`jsPlugins` in .oxlintrc.json). Tested by oxlint-plugin.test.mjs.

/** The attribute `name` on a JSX opening element, or undefined. */
function attribute(opening, name) {
	return opening.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === name)
}

/**
 * In the iPhone app, VoiceOver reads an SF Symbol's name ("inbox", "Forward" for a chevron): on
 * its own, or inside the label of the button around it. Each `SymbolView` must say what VoiceOver
 * does with it: its own `accessibilityLabel`, `accessibilityElementsHidden` when it only
 * decorates, or an element around it (a `Pressable`) with an `accessibilityLabel`.
 */
const symbolNeedsLabel = {
	meta: {
		type: "problem",
		docs: { description: "A SymbolView needs a label, its own or its button's, or to be hidden" },
		messages: {
			unlabeled:
				"VoiceOver reads this symbol's name{{name}}. Give the button around it an accessibilityLabel, or the symbol one, or hide a decorative symbol with accessibilityElementsHidden.",
		},
		schema: [],
	},
	create(context) {
		return {
			JSXOpeningElement(node) {
				if (node.name.type !== "JSXIdentifier" || node.name.name !== "SymbolView") return
				if (node.attributes.some((a) => a.type === "JSXSpreadAttribute")) return
				if (attribute(node, "accessibilityLabel") || attribute(node, "accessibilityElementsHidden"))
					return
				// An element around it, in the same JSX, that is labelled.
				for (let el = node.parent.parent; el; el = el.parent) {
					if (el.type === "JSXElement" && attribute(el.openingElement, "accessibilityLabel")) return
				}
				const name = attribute(node, "name")?.value
				context.report({
					node,
					messageId: "unlabeled",
					data: { name: name?.type === "Literal" ? ` ("${name.value}")` : "" },
				})
			},
		}
	},
}

export default {
	meta: { name: "klipstack" },
	rules: { "symbol-needs-label": symbolNeedsLabel },
}
