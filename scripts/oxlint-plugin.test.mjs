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
			`fdescribe("a", () => {})`,
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
			[`xtest("a", () => {})`, "skip"],
			[`xdescribe("a", () => {})`, "skip"],
			[`const name = "a"; test.skip(name, async () => {})`, "skip"],
			[`for (const c of cases) test.fixme(c.title, async ({ page }) => {})`, "fixme"],
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
			["await tx.execute(sql`TRUNCATE tags`)", "tx.execute"],
			["await db.execute(sql`MERGE INTO tags USING x ON true`)", "db.execute"],
			['await db.execute(sql.raw("DELETE FROM documents"))', "db.execute"],
			["const q = sql`delete from tags`; await db.execute(q)", "db.execute"],
			[
				'import { db as database } from "@klipstack/db"\nawait database.insert(tags).values(row)',
				"database.insert",
			],
		])
			assert.match(lint(code).join(), new RegExp(`Move this \`${what}\` into a command`), code)
	})

	test("reports an import of an ungated per-action module", () => {
		const [message] = lint(`import { publish } from "~/commands/editions-actions.server"`)
		assert.match(message, /skips the feature check and the input caps/)
		assert.equal(lint(`export { publish } from "../commands/editions-actions.server.ts"`).length, 1)
		assert.equal(lint(`await import("~/commands/editions-actions.server")`).length, 1)
		assert.equal(lint(`export * from "~/commands/editions-actions.server"`).length, 1)
	})

	test("accepts reads, commands and other objects' methods", () => {
		assert.deepEqual(lint(`import { publish } from "~/commands/editions.server"`), [])
		assert.deepEqual(lint("await db.select().from(tags); await db.query.user.findFirst()"), [])
		assert.deepEqual(lint("await db.execute(sql`select 1`)"), [])
		assert.deepEqual(
			lint("await db.execute(sql`select id from audit where action = 'delete'`)"),
			[],
		)
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
		assert.equal(lint(`<p>{"Nothing saved yet"}</p>`).length, 1)
		assert.equal(lint(`<button type="button">{open ? "Close" : "Open"}</button>`).length, 2)
		assert.equal(lint(`<p>{error || "Something went wrong"}</p>`).length, 1)
		assert.equal(lint(`<label>email:</label>`).length, 1)
	})

	test("reports text in the attributes readers see or hear", () => {
		for (const jsx of [
			`<nav aria-label="pagination" />`,
			`<img alt="Cover" />`,
			`<input placeholder={"Search"} />`,
			"<abbr title={`Words per minute`} />",
			`<Pressable accessibilityLabel="Close" />`,
			`<Pressable accessibilityHint="Opens the article" />`,
		])
			assert.equal(lint(jsx).length, 1, jsx)
		assert.equal(lint(`<button type="button" aria-label={open ? "Close" : "Open"} />`).length, 2)
	})

	test("accepts translations, glyphs, the name and addresses", () => {
		assert.deepEqual(lint(`<p aria-label={t("nav.label")}>{t("nav.title")}</p>`), [])
		assert.deepEqual(lint(`<p>· — × A 3</p>`), [])
		assert.deepEqual(lint(`<span>&times;</span>`), [])
		assert.deepEqual(lint(`<p className={open ? "block" : "hidden"}>{title}</p>`), [])
		assert.deepEqual(lint(`<svg aria-label="Klipstack" />`), [])
		assert.deepEqual(lint(`<input placeholder="https://" />`), [])
		assert.deepEqual(lint(`<div className="text-sm" data-state="open" id="main" />`), [])
	})

	test("leaves tests alone", () => {
		assert.deepEqual(lint(`<p>Saved</p>`, "c.test.tsx"), [])
	})
})

describe("klipstack/design-scale", () => {
	const lint = (jsx, name = "c.tsx") =>
		lintWith("design-scale", `export const C = () => (\n\t${jsx}\n)\n`, name)

	test("reports a radius or a font size off the scale, in any spelling, after any variant", () => {
		assert.match(lint(`<div className="rounded-[7px]" />`).join(), /`rounded-\[7px\]` is off/)
		for (const jsx of [
			`<div className="flex rounded-t-[3px] p-2" />`,
			`<div className="md:text-[13px]" />`,
			`<div className="!rounded-[3px]" />`,
			`<div className="text-[length:13px]" />`,
			`<div className="rounded-(--r)" />`,
			`<div className="text-(length:--size)" />`,
			`<div className={cn("text-[0.95rem]", open && "block")} />`,
			// oxlint-disable-next-line no-template-curly-in-string -- JSX under test, a template literal
			"<div className={`text-[clamp(1rem,2vw,2rem)] ${x}`} />",
			`<div className="group-hover:rounded-bl-[1px]" />`,
		])
			assert.equal(lint(jsx).length, 1, jsx)
		assert.equal(lint(`<p className="rounded-[2px] text-[10px]" />`).length, 2)
	})

	test("points at the token's line, and survives escapes", () => {
		// The disable comment sits above the string's second line, where the token is, not its first.
		const source = `export const c = cn(\n\t"flex",\n\t// oxlint-disable-next-line klipstack/design-scale -- why\n\t"p-2 rounded-[7px]",\n)\n`
		assert.deepEqual(lintWith("design-scale", source, "at.tsx"), [])
		const template = "export const c = `flex\n\tp-2 rounded-[7px]`\n"
		assert.equal(lintWith("design-scale", template, "tpl.tsx").length, 1)
		assert.equal(lint(`<div className={"rounded-\\u005b3px] text-[10px]"} />`).length, 1)
	})

	test("accepts the scale, colours and other arbitrary values", () => {
		for (const jsx of [
			`<div className="rounded-sm rounded-t-2xl rounded-full text-xs md:text-5xl" />`,
			`<div className="text-[#333] text-[var(--ink)] text-(--ink) w-[13px] leading-[1.6]" />`,
			`<div className="bg-[oklch(var(--l)_0.1_var(--hue))]" />`,
		])
			assert.deepEqual(lint(jsx), [], jsx)
	})

	test("leaves tests alone, and a disable comment says why", () => {
		assert.deepEqual(lint(`<div className="rounded-[7px]" />`, "c.test.tsx"), [])
		const disabled = `<div\n\t\t// oxlint-disable-next-line klipstack/design-scale -- a book's spine\n\t\tclassName="rounded-[7px]"\n\t/>`
		assert.deepEqual(lint(disabled), [])
	})
})

describe("klipstack/hand-made-button", () => {
	const lint = (jsx) =>
		lintWith("hand-made-button", `export const C = () => (\n\t${jsx}\n)\n`, "c.tsx")

	test("reports a button or a link that copies a Button variant's fill", () => {
		assert.match(
			lint(`<button className="rounded-md bg-accent px-3 text-accent-fg">Go</button>`).join(),
			/Button's primary look by hand/,
		)
		assert.match(
			lint(`<Link className={cn("bg-danger text-danger-fg", className)} to="/" />`).join(),
			/Button's danger look/,
		)
		// oxlint-disable-next-line no-template-curly-in-string -- JSX under test, a template literal
		assert.equal(lint("<a className={`bg-accent ${size} text-accent-fg`} />").length, 1)
	})

	test("accepts a fill under a condition, on hover or tinted, elsewhere, and from buttonVariants", () => {
		for (const jsx of [
			`<button className={cn("border", checked && "bg-accent text-accent-fg")} />`,
			`<button className={on ? "bg-accent text-accent-fg" : "bg-card"} />`,
			`<button className="hover:bg-accent hover:text-accent-fg" />`,
			`<button className="bg-accent/10 text-accent-fg" />`,
			`<span className="rounded-full bg-accent text-accent-fg" />`,
			`<a className={buttonVariants({ variant: "primary" })} />`,
		])
			assert.deepEqual(lint(jsx), [], jsx)
	})

	test("a disable for the scale does not silence it", () => {
		const jsx = `<button\n\t\t// oxlint-disable-next-line klipstack/design-scale -- a key cap\n\t\tclassName="bg-accent text-accent-fg text-[10px]"\n\t/>`
		assert.equal(lint(jsx).length, 1)
	})
})
