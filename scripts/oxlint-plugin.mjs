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

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

/** The names along a callee such as `test.describe.skip.each`: ["test", "describe", "skip", "each"]. */
function calleeNames(node) {
	if (node.type === "Identifier") return [node.name]
	if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
		const object = calleeNames(node.object)
		return object && [...object, node.property.name]
	}
	return null
}

const TEST_ROOTS = new Set(["test", "it", "describe", "suite", "bench"])
const OFF = new Set(["skip", "todo", "fixme"])
const SHORTHAND = { xit: "skip", xtest: "skip", xdescribe: "skip", fit: "only", fdescribe: "only" }

/**
 * A test or suite that is focused (`.only`) or turned off (`.skip`, `.todo`, `.fixme`, `xit`) in
 * Vitest or Playwright. One under a condition stays allowed, as Playwright's
 * `test.skip(!process.env.CI, reason)`, and `skipIf` and `runIf`: the review judges those.
 */
const noSkippedTests = {
	meta: {
		type: "problem",
		docs: { description: "No focused or skipped tests" },
		messages: {
			only: "`.only` runs this test alone and leaves the rest unchecked. Remove it before committing.",
			off: "`.{{how}}` turns this test off, so it holds nothing. Fix the test or the code. A test that is wrong now is changed or deleted openly, and the change says why. One that cannot run somewhere waits on a condition: `test.skip(condition, reason)`.",
		},
		schema: [],
	},
	create(context) {
		return {
			CallExpression(node) {
				const names = calleeNames(node.callee)
				if (!names) return
				const how =
					names.length === 1
						? SHORTHAND[names[0]]
						: TEST_ROOTS.has(names[0]) && names.slice(1).find((n) => n === "only" || OFF.has(n))
				if (!how) return
				// Playwright's conditional form, `test.skip(condition, reason)` or `test.fixme(() => …)`:
				// not a test's name, nor nothing or a plain `true`.
				const [first] = node.arguments
				const defines =
					names.at(-1) === "each" ||
					!first ||
					(first.type === "Literal" && (typeof first.value === "string" || first.value === true)) ||
					first.type === "TemplateLiteral"
				if (how !== "only" && how !== "todo" && !defines) return
				context.report({
					node: node.callee,
					messageId: how === "only" ? "only" : "off",
					data: { how },
				})
			},
		}
	},
}

const WRITES = new Set(["insert", "update", "delete", "transaction"])
const WRITE_SQL = /\b(insert|update|delete|truncate|merge)\b/i
const ACTIONS_MODULE = /(^|\/)commands\/[^/]+-actions\.server(\.ts)?$/

/**
 * Web route actions, API handlers and MCP tools change user data only by calling a command
 * (`apps/web/app/commands`, "Commands" in AGENTS.md). This reports what can be read from the code:
 * an adapter that writes through `db` or `tx` itself, opens a transaction, runs writing SQL, or
 * imports an ungated per-action module (`commands/*-actions.server.ts`). A writing service called
 * from an adapter is left to the review (.agents/checks/commands.md).
 */
const adapterWritesThroughCommands = {
	meta: {
		type: "problem",
		docs: { description: "Adapters change user data only by calling a command" },
		messages: {
			write:
				"An adapter changes user data only by calling a command in app/commands/, which holds the limits, ownership and the transaction (AGENTS.md, Commands). Move this `{{what}}` into a command and call it.",
			actions:
				"`{{source}}` skips the feature check and the input caps of its gated command. Import the command from the module without `-actions`.",
		},
		schema: [],
	},
	create(context) {
		if (TEST_FILE.test(context.filename)) return {}
		const checkSource = (source) => {
			if (source?.type === "Literal" && ACTIONS_MODULE.test(String(source.value)))
				context.report({ node: source, messageId: "actions", data: { source: source.value } })
		}
		return {
			ImportDeclaration: (node) => checkSource(node.source),
			ImportExpression: (node) => checkSource(node.source),
			ExportNamedDeclaration: (node) => checkSource(node.source),
			ExportAllDeclaration: (node) => checkSource(node.source),
			CallExpression(node) {
				const callee = node.callee
				if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return
				if (callee.object.name !== "db" && callee.object.name !== "tx") return
				const method = callee.property.type === "Identifier" ? callee.property.name : ""
				const [first] = node.arguments
				const writingSql =
					method === "execute" &&
					first?.type === "TaggedTemplateExpression" &&
					first.quasi.quasis.some((q) => WRITE_SQL.test(q.value.raw))
				if (!WRITES.has(method) && !writingSql) return
				context.report({
					node: callee,
					messageId: "write",
					data: { what: `${callee.object.name}.${method}` },
				})
			},
		}
	},
}

const LETTERS = /\p{L}.*\p{L}/su
const UI_TEXT_ATTRIBUTES = new Set([
	"alt",
	"aria-description",
	"aria-label",
	"aria-placeholder",
	"aria-roledescription",
	"aria-valuetext",
	"placeholder",
	"title",
	"accessibilityHint",
	"accessibilityLabel",
])
/** Text that reads the same in every language: the name, and an address or its scheme. */
const UNTRANSLATED = /^(Klipstack|[a-z][a-z+.-]*:(\/\/\S*)?)$/

/**
 * Text a reader sees or hears, written in a component as a literal: in the JSX, or in an
 * attribute screen readers or browsers show (`aria-label`, `title`, `placeholder`…). It belongs in
 * the locales of both languages (`packages/i18n/src/locales`), read with `t()`. Text with fewer
 * than two letters (a glyph, "A" as a size sample) and the brand's name pass.
 */
const uiTextTranslated = {
	meta: {
		type: "problem",
		docs: { description: "User-facing text comes from the translations" },
		messages: {
			literal:
				'"{{text}}" is shown to readers in one language only. Add a key to the English and Spanish locales (packages/i18n/src/locales) and read it with t().',
		},
		schema: [],
	},
	create(context) {
		if (TEST_FILE.test(context.filename)) return {}
		const check = (node, text) => {
			const trimmed = text.trim().replace(/\s+/g, " ")
			if (!LETTERS.test(trimmed) || UNTRANSLATED.test(trimmed)) return
			const shown = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed
			// At the text's first character, not the line break before it, so that a disable comment
			// goes on the line above the text.
			const source = context.sourceCode
			const start = source.getLocFromIndex(node.range[0] + (text.length - text.trimStart().length))
			const loc = { start, end: source.getLocFromIndex(node.range[1]) }
			context.report({ loc, messageId: "literal", data: { text: shown } })
		}
		return {
			JSXText: (node) => check(node, node.value),
			JSXAttribute(node) {
				if (node.name.type !== "JSXIdentifier" || !UI_TEXT_ATTRIBUTES.has(node.name.name)) return
				let value = node.value
				if (value?.type === "JSXExpressionContainer") value = value.expression
				if (value?.type === "Literal" && typeof value.value === "string") check(value, value.value)
				else if (value?.type === "TemplateLiteral" && value.expressions.length === 0)
					check(value, value.quasis[0].value.cooked ?? "")
			},
		}
	},
}

export default {
	meta: { name: "klipstack" },
	rules: {
		"symbol-needs-label": symbolNeedsLabel,
		"no-skipped-tests": noSkippedTests,
		"adapter-writes-through-commands": adapterWritesThroughCommands,
		"ui-text-translated": uiTextTranslated,
	},
}
