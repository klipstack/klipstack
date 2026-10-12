// Klipstack's own oxlint rules (`jsPlugins` in .oxlintrc.json). Tested by oxlint-plugin.test.mjs.

/** The attribute `name` on a JSX opening element, unless its value is `{false}` or `{undefined}`. */
function attribute(opening, name) {
	const found = opening.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === name)
	const value = found?.value?.type === "JSXExpressionContainer" ? found.value.expression : null
	if (value?.type === "Literal" && value.value === false) return undefined
	if (value?.type === "Identifier" && value.name === "undefined") return undefined
	return found
}

const FUNCTION = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"])

/**
 * In the iPhone app, VoiceOver reads an SF Symbol's name ("inbox", "Forward" for a chevron): on
 * its own, or inside the label of the button around it. Each `SymbolView` must say what VoiceOver
 * does with it: its own `accessibilityLabel`, `accessibilityElementsHidden` when it only
 * decorates, or a label around it: on the nearest `Pressable`, which VoiceOver reads as one
 * element, or on an element between the two. The rule looks only within the JSX the symbol is
 * written in, and trusts a spread (`{...props}`) to carry a label.
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
				// Up to the nearest Pressable, which VoiceOver reads as one element, within this JSX.
				for (let el = node.parent.parent; el && !FUNCTION.has(el.type); el = el.parent) {
					if (el.type !== "JSXElement") continue
					if (attribute(el.openingElement, "accessibilityLabel")) return
					if (el.openingElement.name.name === "Pressable") break
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
