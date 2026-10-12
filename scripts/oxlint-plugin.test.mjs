// node --test scripts/*.test.mjs: Klipstack's own oxlint rules (oxlint-plugin.mjs), run by oxlint.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"

const root = join(import.meta.dirname, "..")
const dir = mkdtempSync(join(tmpdir(), "oxlint-plugin-test-"))
after(() => rmSync(dir, { recursive: true, force: true }))
writeFileSync(
	join(dir, ".oxlintrc.json"),
	JSON.stringify({
		plugins: [],
		jsPlugins: [join(root, "scripts/oxlint-plugin.mjs")],
		rules: { "klipstack/symbol-needs-label": "error" },
	}),
)

/** The messages of klipstack's rules on a component whose JSX is `jsx`. */
function lint(jsx) {
	const file = join(dir, "component.tsx")
	writeFileSync(file, `export function C() {\n\treturn (${jsx})\n}\n`)
	const run = spawnSync(
		join(root, "node_modules/.bin/oxlint"),
		["-c", join(dir, ".oxlintrc.json"), "--format", "json", file],
		{ encoding: "utf8" },
	)
	const output = JSON.parse(run.stdout)
	return output.diagnostics.filter((d) => d.code.startsWith("klipstack")).map((d) => d.message)
}

describe("klipstack/symbol-needs-label", () => {
	test("reports a symbol that VoiceOver would read by name", () => {
		const [message] = lint(`<View><SymbolView name="tray" /><Text>Inbox</Text></View>`)
		assert.match(message, /reads this symbol's name \("tray"\)/)
		assert.match(message, /accessibilityElementsHidden/)
	})

	test("reports a symbol in a button without a label", () => {
		const jsx = `<Pressable onPress={go}><SymbolView name={icon} /><Text>{title}</Text></Pressable>`
		assert.equal(lint(jsx).length, 1)
	})

	test("reports a symbol in an unlabelled button inside a labelled element", () => {
		const jsx = `<View accessibilityLabel="Places"><Pressable><SymbolView name="tray" /></Pressable></View>`
		assert.equal(lint(jsx).length, 1)
	})

	test("does not look past the function the symbol is written in", () => {
		const jsx = `<FlatList accessibilityLabel="Tags" renderItem={() => <SymbolView name="tag" />} />`
		assert.equal(lint(jsx).length, 1)
	})

	test("reports a label or hiding turned off", () => {
		assert.equal(lint(`<SymbolView name="tray" accessibilityElementsHidden={false} />`).length, 1)
		assert.equal(lint(`<SymbolView name="tray" accessibilityLabel={undefined} />`).length, 1)
	})

	test("accepts a labelled button around the symbol, at any depth", () => {
		const jsx = `<Pressable accessibilityLabel={title}><View><SymbolView name="tray" /></View></Pressable>`
		assert.deepEqual(lint(jsx), [])
	})

	test("accepts a symbol with its own label, or hidden", () => {
		assert.deepEqual(lint(`<SymbolView name="star.fill" accessibilityLabel="Starred" />`), [])
		assert.deepEqual(lint(`<SymbolView name="newspaper" accessibilityElementsHidden />`), [])
	})

	test("trusts a spread to carry the label", () => {
		assert.deepEqual(lint(`<SymbolView name="tray" {...props} />`), [])
	})
})
