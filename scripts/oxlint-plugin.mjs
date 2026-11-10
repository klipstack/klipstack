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
				// not a test's name and body, nor nothing or a plain `true`.
				const [first, second] = node.arguments
				const defines =
					names.at(-1) === "each" ||
					!first ||
					(first.type === "Literal" && (typeof first.value === "string" || first.value === true)) ||
					first.type === "TemplateLiteral" ||
					FUNCTION.has(second?.type)
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
/** A quoted SQL value, whose words are data, not statements: `action = 'delete'`. */
const SQL_STRING = /'(?:[^']|'')*'/g
const ACTIONS_MODULE = /(^|\/)commands\/[^/]+-actions\.server(\.ts)?$/

/**
 * Web route actions, API handlers and MCP tools change user data only by calling a command
 * (`apps/web/app/commands`, "Commands" in AGENTS.md). This reports what can be read from the code:
 * an adapter that writes through `db` or `tx` itself (under any name it imports `db` as), opens a
 * transaction, runs SQL that writes or that the rule cannot read (`sql.raw`, a query built
 * elsewhere), or imports an ungated per-action module (`commands/*-actions.server.ts`). A writing
 * service called from an adapter is left to the review (.agents/checks/commands.md).
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
		const handles = new Set(["db", "tx"])
		return {
			ImportDeclaration(node) {
				checkSource(node.source)
				if (node.source.value !== "@klipstack/db") return
				for (const s of node.specifiers)
					if (s.type === "ImportSpecifier" && s.imported.name === "db") handles.add(s.local.name)
			},
			ImportExpression: (node) => checkSource(node.source),
			ExportNamedDeclaration: (node) => checkSource(node.source),
			ExportAllDeclaration: (node) => checkSource(node.source),
			CallExpression(node) {
				const callee = node.callee
				if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return
				if (!handles.has(callee.object.name)) return
				const method = callee.property.type === "Identifier" ? callee.property.name : ""
				const [first] = node.arguments
				const sqlText =
					first?.type === "TaggedTemplateExpression"
						? first.quasi.quasis.map((q) => q.value.raw).join(" ")
						: null
				const writingSql =
					method === "execute" &&
					(sqlText === null || WRITE_SQL.test(sqlText.replace(SQL_STRING, "''")))
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
/** Text that reads the same in every language: the name, and a web address or its start. */
const UNTRANSLATED = /^(Klipstack|https?:\/\/\S*)$/
/** Character references, which stand for one character: `&times;`, `&#215;`. */
const ENTITY = /&(#\d+|#x[\da-f]+|[a-z]+\d*);/gi

/**
 * Text a reader sees or hears, written in a component as a literal: in the JSX, as JSX text or a
 * string in braces (`{"Saved"}`, `{open ? "Close" : "Open"}`), or in an attribute screen readers
 * or browsers show (`aria-label`, `title`, `placeholder`…). It belongs in
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
			if (!LETTERS.test(trimmed.replace(ENTITY, "")) || UNTRANSLATED.test(trimmed)) return
			const shown = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed
			// At the text's first character, not the line break before it, so that a disable comment
			// goes on the line above the text.
			const source = context.sourceCode
			const start = source.getLocFromIndex(node.range[0] + (text.length - text.trimStart().length))
			const loc = { start, end: source.getLocFromIndex(node.range[1]) }
			context.report({ loc, messageId: "literal", data: { text: shown } })
		}
		/** The strings `value` can be: itself, or the branches of a `?:`, `&&` or `||`. */
		const checkValue = (value) => {
			if (value?.type === "Literal" && typeof value.value === "string") check(value, value.value)
			else if (value?.type === "TemplateLiteral" && value.expressions.length === 0)
				check(value, value.quasis[0].value.cooked ?? "")
			else if (value?.type === "ConditionalExpression") {
				checkValue(value.consequent)
				checkValue(value.alternate)
			} else if (value?.type === "LogicalExpression") checkValue(value.right)
		}
		return {
			JSXText: (node) => check(node, node.value),
			JSXExpressionContainer(node) {
				if (node.parent?.type === "JSXElement" || node.parent?.type === "JSXFragment")
					checkValue(node.expression)
			},
			JSXAttribute(node) {
				if (node.name.type !== "JSXIdentifier" || !UI_TEXT_ATTRIBUTES.has(node.name.name)) return
				const value = node.value
				checkValue(value?.type === "JSXExpressionContainer" ? value.expression : value)
			},
		}
	},
}

/** A radius or a font size off Tailwind's scale, after any variants: `rounded-t-[3px]`, `sm:text-[13px]`. */
const OFF_SCALE =
	/(?<=^|[\s:"'`!])(rounded(?:-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?-(?:\[[^\]\s]+\]|\([^)\s]+\))|text-(?:\[(?:length:|[\d.]|clamp\(|calc\(|min\(|max\()[^\]\s]*\]|\(length:[^)\s]+\)))/g
/** A Button variant's fill, copied by hand: its background with its text colour. */
const BUTTON_FILLS = [
	["bg-accent", "text-accent-fg", "primary"],
	["bg-danger", "text-danger-fg", "danger"],
]
const BUTTON_LIKE = new Set(["button", "a", "Link", "NavLink"])

/**
 * The classes `value` always applies: its strings, and those passed straight to `cn()`. Not those
 * under a condition (`checked && "bg-accent"`): a state of a toggle, not the look of a button.
 */
function alwaysApplied(value, out = []) {
	if (value?.type === "JSXExpressionContainer") return alwaysApplied(value.expression, out)
	if (value?.type === "Literal" && typeof value.value === "string") out.push(value.value)
	else if (value?.type === "TemplateLiteral")
		for (const q of value.quasis) out.push(q.value.cooked ?? q.value.raw)
	else if (value?.type === "CallExpression")
		for (const arg of value.arguments) alwaysApplied(arg, out)
	return out
}

/**
 * The look of the web app comes from its scale. A radius or a font size written as an arbitrary
 * value (`rounded-[7px]`, `text-[13px]`) drifts from it a pixel at a time. A drawing that needs its
 * own value (a book's spine, the phone in the landing page) says why in a disable comment.
 */
const designScale = {
	meta: {
		type: "suggestion",
		docs: { description: "Radii and font sizes from the scale" },
		messages: {
			offScale:
				"`{{token}}` is off the design scale. Use the scale (rounded-xs…rounded-4xl, rounded-full; text-xs…text-9xl), or say why this one differs in a disable comment.",
		},
		schema: [],
	},
	create(context) {
		if (TEST_FILE.test(context.filename)) return {}
		const source = context.sourceCode
		/** In the source as written, at the token itself: a disable comment goes on the line above. */
		const check = (node) => {
			const [from, to] = node.range
			for (const match of source.text.slice(from, to).matchAll(OFF_SCALE)) {
				const start = from + match.index
				context.report({
					loc: {
						start: source.getLocFromIndex(start),
						end: source.getLocFromIndex(start + match[0].length),
					},
					messageId: "offScale",
					data: { token: match[0] },
				})
			}
		}
		return {
			Literal(node) {
				if (typeof node.value === "string") check(node)
			},
			TemplateElement: check,
		}
	},
}

/**
 * A `<button>` or a link that copies Button's primary or danger fill drifts from Button. Use it, or
 * `buttonVariants` on a link. Only the classes always applied count: a toggle's checked state is
 * not a button's look.
 */
const handMadeButton = {
	meta: {
		type: "suggestion",
		docs: { description: "Buttons from Button, not its fill copied by hand" },
		messages: {
			handMade:
				'This copies Button\'s {{variant}} look by hand. Use <Button variant="{{variant}}">, or buttonVariants({ variant: "{{variant}}" }) on a link.',
		},
		schema: [],
	},
	create(context) {
		if (TEST_FILE.test(context.filename)) return {}
		return {
			JSXOpeningElement(node) {
				if (node.name.type !== "JSXIdentifier" || !BUTTON_LIKE.has(node.name.name)) return
				const className = node.attributes.find(
					(a) => a.type === "JSXAttribute" && a.name.name === "className",
				)
				if (!className?.value) return
				const classes = new Set(alwaysApplied(className.value).join(" ").split(/\s+/))
				const fill = BUTTON_FILLS.find(([bg, fg]) => classes.has(bg) && classes.has(fg))
				if (fill)
					context.report({ node: className, messageId: "handMade", data: { variant: fill[2] } })
			},
		}
	},
}

/** The status columns that have a machine in packages/db/src/machines.ts, by table. */
const MACHINE_COLUMNS = {
	documents: new Set(["status", "translationStatus"]),
	topics: new Set(["status"]),
}

/** The write each method follows: `update(t).set()`, `insert(t).values()`, its upsert's `set`. */
const WRITER = { set: "update", values: "insert", onConflictDoUpdate: "insert" }

/** A literal, or a choice between literals (`final ? "failed" : "queued"`, `x ?? "ready"`). */
function literal(node) {
	while (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression")
		node = node.expression
	if (node.type === "Literal" || node.type === "TemplateLiteral") return true
	if (node.type === "ConditionalExpression")
		return literal(node.consequent) || literal(node.alternate)
	if (node.type === "LogicalExpression") return literal(node.right)
	return false
}

/** Every node under `node` (not `node` itself), without climbing back to parents. */
function* descendants(node) {
	for (const [key, value] of Object.entries(node)) {
		if (key === "parent" || !value || typeof value !== "object") continue
		for (const child of Array.isArray(value) ? value : [value])
			if (child && typeof child.type === "string") {
				yield child
				yield* descendants(child)
			}
	}
}

/**
 * A status kept in a column with a machine (packages/db/src/machines.ts) changes through one of
 * its transitions: `.set({ status: extractionMachine.transitions.publish.to })`, not
 * `.set({ status: "ready" })`. The machine then lists every move and every writer finds it. The
 * rule reads `.set()` after `update(documents)` or `update(topics)`, and `.values()` after their
 * `insert` and its `onConflictDoUpdate`. Hand-written SQL, and a status passed in a variable or a
 * spread, are not checked.
 */
const statusThroughMachine = {
	meta: {
		type: "problem",
		docs: { description: "A status with a machine changes through one of its transitions" },
		messages: {
			literal:
				"{{table}}.{{column}} has a machine: write one of its transitions' `to` (packages/db/src/machines.ts), adding the transition there if it is new, not a literal.",
		},
		schema: [],
	},
	create(context) {
		if (TEST_FILE.test(context.filename)) return {}
		return {
			CallExpression(node) {
				const callee = node.callee
				if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return
				const writer = WRITER[callee.property.name]
				if (!writer) return
				// Down the chain to the update or insert: `.values(…).onConflictDoUpdate(…)`.
				let write = callee.object
				while (
					write.type === "CallExpression" &&
					write.callee.type === "MemberExpression" &&
					write.callee.property.name !== writer
				)
					write = write.callee.object
				if (write.type !== "CallExpression" || write.callee.type !== "MemberExpression") return
				const table = write.arguments[0]?.type === "Identifier" ? write.arguments[0].name : ""
				const columns = MACHINE_COLUMNS[table]
				if (!columns) return
				for (const arg of node.arguments)
					for (const n of descendants(arg)) {
						if (n.type !== "Property" || n.computed) continue
						const column = n.key.type === "Identifier" ? n.key.name : n.key.value
						if (!columns.has(column)) continue
						if (literal(n.value))
							context.report({ node: n, messageId: "literal", data: { table, column } })
					}
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
		"design-scale": designScale,
		"hand-made-button": handMadeButton,
		"status-through-machine": statusThroughMachine,
	},
}
