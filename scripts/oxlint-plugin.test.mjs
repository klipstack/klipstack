// node --test scripts/*.test.mjs: Klipstack's own oxlint rules (oxlint-plugin.mjs), run by oxlint.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, describe, test } from "node:test"

const root = join(import.meta.dirname, "..")
const dir = mkdtempSync(join(tmpdir(), "oxlint-plugin-test-"))
after(() => rmSync(dir, { recursive: true, force: true }))
/** The messages of klipstack's `rule`, alone, on `source` in a file named `name`. */
function lintWith(rule, source, name = "component.tsx") {
	const config = join(dir, `${rule}.oxlintrc.json`)
	writeFileSync(
		config,
		JSON.stringify({
			plugins: [],
			jsPlugins: [join(root, "scripts/oxlint-plugin.mjs")],
			rules: { [`klipstack/${rule}`]: "error" },
		}),
	)
	const file = join(dir, name)
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, source)
	const run = spawnSync(
		join(root, "node_modules/.bin/oxlint"),
		["-c", config, "--format", "json", file],
		{ encoding: "utf8" },
	)
	const output = JSON.parse(run.stdout)
	return output.diagnostics.filter((d) => d.code.startsWith("klipstack")).map((d) => d.message)
}

/** The messages of symbol-needs-label on a component whose JSX is `jsx`. */
const lint = (jsx) =>
	lintWith("symbol-needs-label", `export function C() {\n\treturn (${jsx})\n}\n`)

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

describe("klipstack/no-skipped-tests", () => {
	const lint = (code) => lintWith("no-skipped-tests", `${code}\n`, "x.test.ts")

	test("reports focused tests and suites, in Vitest and Playwright", () => {
		for (const code of [
			`it.only("a", () => {})`,
			`test.only("a", async () => {})`,
			`describe.only("a", () => {})`,
			`test.describe.only("a", () => {})`,
			`it.only.each([1])("a %s", () => {})`,
			`fit("a", () => {})`,
		])
			assert.match(lint(code).join(), /`\.only` runs this test alone/, code)
	})

	test("reports tests turned off", () => {
		for (const [code, how] of [
			[`it.skip("a", () => {})`, "skip"],
			[`test.skip("a", async () => {})`, "skip"],
			[`test.describe.skip("a", () => {})`, "skip"],
			[`describe.skip(\`a\`, () => {})`, "skip"],
			[`it.skip.each([1])("a %s", () => {})`, "skip"],
			[`it.todo("a")`, "todo"],
			[`test.fixme("a", async () => {})`, "fixme"],
			[`test("a", async () => { test.skip() })`, "skip"],
			[`test("a", async () => { test.fixme(true, "later") })`, "fixme"],
			[`xit("a", () => {})`, "skip"],
		])
			assert.match(lint(code).join(), new RegExp(`\`\\.${how}\` turns this test off`), code)
	})

	test("leaves a skip under a condition to the review", () => {
		assert.deepEqual(lint(`test("a", async () => { test.skip(!process.env.CI, "needs CI") })`), [])
		assert.deepEqual(lint(`test.fixme(({ browserName }) => browserName === "webkit", "x")`), [])
		assert.deepEqual(lint(`it.skipIf(process.env.CI)("a", () => {})`), [])
	})

	test("accepts plain tests and other members", () => {
		assert.deepEqual(lint(`test("a", async () => {}); test.describe.serial("b", () => {})`), [])
		assert.deepEqual(lint(`test.step("a", async () => {}); skip.only = 1; list.skip("a")`), [])
	})
})

describe("klipstack/adapter-writes-through-commands", () => {
	const lint = (code, name = "routes/x.ts") =>
		lintWith("adapter-writes-through-commands", `${code}\n`, name)

	test("reports an adapter that writes through the database itself", () => {
		for (const [code, what] of [
			["await db.insert(tags).values(row)", "db.insert"],
			["await db\n\t.update(documents)\n\t.set({ title })", "db.update"],
			["await tx.delete(highlights).where(x)", "tx.delete"],
			["await db.transaction(async (tx) => {})", "db.transaction"],
			[`await db.execute(sql\`UPDATE documents SET title = \${title}\`)`, "db.execute"],
		])
			assert.match(lint(code).join(), new RegExp(`Move this \`${what}\` into a command`), code)
	})

	test("reports an import of an ungated per-action module", () => {
		const [message] = lint(`import { publish } from "~/commands/editions-actions.server"`)
		assert.match(message, /skips the feature check and the input caps/)
		assert.equal(lint(`export { publish } from "../commands/editions-actions.server.ts"`).length, 1)
		assert.equal(lint(`await import("~/commands/editions-actions.server")`).length, 1)
	})

	test("accepts reads, commands and other objects' methods", () => {
		assert.deepEqual(lint(`import { publish } from "~/commands/editions.server"`), [])
		assert.deepEqual(lint("await db.select().from(tags); await db.query.user.findFirst()"), [])
		assert.deepEqual(lint("await db.execute(sql`select 1`)"), [])
		assert.deepEqual(lint(`params.delete("time"); cache.delete(key); map.update(x)`), [])
	})

	test("leaves tests alone", () => {
		assert.deepEqual(lint("await db.insert(tags).values(row)", "routes/x.test.ts"), [])
	})
})

describe("klipstack/ui-text-translated", () => {
	const lint = (jsx, name = "c.tsx") =>
		lintWith("ui-text-translated", `export const C = () => (\n\t${jsx}\n)\n`, name)

	test("reports text written in the JSX", () => {
		assert.match(lint(`<p>Saved to your library</p>`).join(), /"Saved to your library" is shown/)
		assert.equal(lint(`<button type="button">\n\t\tDelete\n\t</button>`).length, 1)
		assert.equal(lint(`<p>{count} artículos</p>`).length, 1)
	})

	test("reports text in the attributes readers see or hear", () => {
		for (const jsx of [
			`<nav aria-label="pagination" />`,
			`<img alt="Cover" />`,
			`<input placeholder={"Search"} />`,
			"<abbr title={`Words per minute`} />",
			`<Pressable accessibilityLabel="Close" />`,
		])
			assert.equal(lint(jsx).length, 1, jsx)
	})

	test("accepts translations, glyphs, the name and addresses", () => {
		assert.deepEqual(lint(`<p aria-label={t("nav.label")}>{t("nav.title")}</p>`), [])
		assert.deepEqual(lint(`<p>· — × A 3</p>`), [])
		assert.deepEqual(lint(`<svg aria-label="Klipstack" />`), [])
		assert.deepEqual(lint(`<input placeholder="https://" />`), [])
		assert.deepEqual(lint(`<div className="text-sm" data-state="open" id="main" />`), [])
	})

	test("leaves tests alone", () => {
		assert.deepEqual(lint(`<p>Saved</p>`, "c.test.tsx"), [])
	})
})
