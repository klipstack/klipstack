/**
 * The Chrome Web Store's screenshots (brand/chrome-web-store/README.md), in English and Spanish:
 * the extension saving a page, the page in the reader, and the library. It drives the real
 * extension, built for the app at `--url`, in Chromium, signed in to the demo account, then frames
 * each capture in a browser window under a caption, 1280×800 without transparency.
 *
 *   pnpm --filter @klipstack/web store-screenshots --url <app address>
 *
 * The sample article, one per language, is served by the script itself. Saving it adds it to the
 * account once: a later run finds it saved, and shows the copy the account already has. The
 * account's language is set for each run and put back after. Fonts are the machine's, as in a
 * browser: run it on a Mac for the fonts most readers see.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { type BrowserContext, chromium, type Page } from "@playwright/test"
import sharp from "sharp"

const { values: args } = parseArgs({
	options: {
		url: { type: "string" },
		email: { type: "string", default: "reader@demo.klipstack.test" },
		password: { type: "string", default: "local-reader-only" },
	},
})
if (!args.url) throw new Error("--url <app address> is required")
const appUrl = args.url.replace(/\/+$/, "")

const root = resolve(import.meta.dirname, "../../..")
const out = resolve(root, "brand/chrome-web-store")
const extOut = resolve(root, "apps/extension/dist/store")
const font = (name: string) =>
	readFileSync(resolve(root, `brand/fonts/newsreader-${name}.ttf`)).toString("base64")

// The window's page area, captured at 2x for sharp text.
const PAGE = { width: 1120, height: 576 }

type Lang = "en" | "es"

const copy = {
	en: {
		captions: [
			["Save any page with one click", "Exactly as you see it, even behind a login or a paywall."],
			["Read it later, without the clutter", "Highlight, take notes, and come back to it anytime."],
			["Everything you saved, in one calm place", "Search, tag and sort your library."],
		],
		url: "https://fieldnotes.example/2026/the-margin-is-where-reading-happens",
		site: "Field Notes",
		nav: ["Essays", "Reviews", "Letters", "Subscribe"],
		kicker: "Essay",
		title: "The margin is where reading happens",
		byline: "By Laura Méndez · October 2026",
		body: [
			"Most of what we read leaves no mark. We finish an article, close the tab, and by the evening only a vague feeling remains: something about attention, something about cities, a phrase we liked and can no longer find.",
			"Readers of paper books never had this problem in quite the same way. They wrote in the margins. A line under a sentence, a question mark, a word of disagreement: small acts that turned someone else's text into a conversation.",
			"The web took the margins away. Pages scroll past, change, disappear behind paywalls or redesigns. The article we meant to come back to is rarely there when we do.",
			"Keeping a copy is the first step. Not a bookmark, which points at a page that may change, but the words themselves, as they were when we read them, somewhere quiet enough to read them again.",
			"The second step is the margin. One highlighted sentence and one line of our own are often enough. They are what we remember, and what we find again years later.",
		],
	},
	es: {
		captions: [
			[
				"Guarda cualquier página con un clic",
				"Tal como la ves, incluso con sesión iniciada o suscripción.",
			],
			["Léela después, sin distracciones", "Subraya, toma notas y vuelve cuando quieras."],
			["Todo lo que guardaste, en un lugar tranquilo", "Busca, etiqueta y ordena tu biblioteca."],
		],
		url: "https://fieldnotes.example/es/2026/en-el-margen-es-donde-se-lee",
		site: "Field Notes",
		nav: ["Ensayos", "Reseñas", "Cartas", "Suscríbete"],
		kicker: "Ensayo",
		title: "En el margen es donde se lee",
		byline: "Por Laura Méndez · Octubre de 2026",
		body: [
			"Casi todo lo que leemos no deja huella. Terminamos un artículo, cerramos la pestaña y por la noche solo queda una impresión vaga: algo sobre la atención, algo sobre las ciudades, una frase que nos gustó y que ya no encontramos.",
			"Los lectores de libros en papel nunca tuvieron este problema del mismo modo. Escribían en los márgenes. Una línea bajo una frase, un signo de pregunta, una palabra de desacuerdo: gestos pequeños que convertían el texto de otro en una conversación.",
			"La web nos quitó los márgenes. Las páginas pasan, cambian, desaparecen tras un muro de pago o un rediseño. El artículo al que pensábamos volver casi nunca está ahí cuando volvemos.",
			"Guardar una copia es el primer paso. No un marcador, que apunta a una página que puede cambiar, sino las palabras mismas, tal como eran cuando las leímos, en un lugar lo bastante tranquilo para volver a leerlas.",
			"El segundo paso es el margen. Una frase subrayada y una línea propia suelen bastar. Son lo que recordamos, y lo que volvemos a encontrar años después.",
		],
	},
} satisfies Record<Lang, unknown>

/** A magazine's article page, the page the extension saves. */
function articlePage(lang: Lang): string {
	const c = copy[lang]
	return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>${c.title} · ${c.site}</title>
<meta property="og:type" content="article"><meta property="og:site_name" content="${c.site}">
<meta property="og:title" content="${c.title}"><meta name="author" content="Laura Méndez">
<style>
@font-face { font-family: Display; src: url(data:font/ttf;base64,${font("600-opsz72")}); }
@font-face { font-family: Text; src: url(data:font/ttf;base64,${font("400-opsz40")}); }
body { margin: 0; background: #f6f1ea; color: #2a2522; font: 20px/1.65 Text, Georgia, serif; }
header { display: flex; align-items: center; justify-content: space-between; padding: 18px 56px;
	border-bottom: 1px solid #e3d9cc; background: #fffaf3; }
.logo { font: 26px Display, serif; letter-spacing: -0.01em; color: #7a2e1d; }
nav { display: flex; gap: 28px; font: 15px system-ui, sans-serif; color: #6b5f57; }
nav span:last-child { color: #fff; background: #7a2e1d; padding: 6px 14px; border-radius: 999px; }
main { max-width: 720px; margin: 0 auto; padding: 44px 24px 80px; }
.kicker { font: 600 13px system-ui, sans-serif; letter-spacing: 0.14em; text-transform: uppercase;
	color: #7a2e1d; }
h1 { font: 50px/1.08 Display, serif; letter-spacing: -0.02em; margin: 10px 0 14px; }
.byline { font: 15px system-ui, sans-serif; color: #6b5f57; margin-bottom: 28px; }
.art { height: 150px; border-radius: 10px; margin-bottom: 30px;
	background: radial-gradient(circle at 20% 30%, #e9b48a 0 18%, transparent 19%),
		radial-gradient(circle at 70% 60%, #c9d6c3 0 26%, transparent 27%),
		linear-gradient(120deg, #f0dcc4, #e6c9a8 60%, #d9b28e); }
p { margin: 0 0 1.1em; }
</style></head><body>
<header><div class="logo">${c.site}</div><nav>${c.nav.map((n) => `<span>${n}</span>`).join("")}</nav></header>
<main><div class="kicker">${c.kicker}</div><h1>${c.title}</h1><div class="byline">${c.byline}</div>
<div class="art" role="presentation"></div>
<article>${c.body.map((p) => `<p>${p}</p>`).join("\n")}</article></main></body></html>`
}

/** Clicks the extension's toolbar button on `tab`, as a person would (CDP). */
async function clickButton(context: BrowserContext, extensionId: string, tab: Page) {
	const cdp = await context.browser()!.newBrowserCDPSession()
	const { targetInfos } = await cdp.send("Target.getTargets", {
		filter: [{ type: "tab", exclude: false }],
	})
	const target = targetInfos.find((t) => t.url === tab.url())
	if (!target) throw new Error(`no tab target for ${tab.url()}`)
	await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId })
}

/** The account's language, through its settings form. */
async function setLanguage(page: Page, locale: string) {
	await page.goto(`${appUrl}/settings/account`, { waitUntil: "networkidle" })
	const form = page.locator("form", { has: page.locator("#locale") })
	await form.locator("#locale").selectOption(locale)
	await form.locator('button[type="submit"]').click()
	await form.getByRole("status").waitFor()
}

/** The three captures for one language, as PNG buffers at 2x. */
async function capture(lang: Lang): Promise<Buffer[]> {
	const ext = resolve(extOut, "chrome-mv3")
	const context = await chromium.launchPersistentContext("", {
		channel: "chromium",
		args: [
			`--disable-extensions-except=${ext}`,
			`--load-extension=${ext}`,
			"--enable-unsafe-extension-debugging",
			`--lang=${lang}`,
		],
		env: { ...process.env, LANGUAGE: lang },
		locale: lang,
		viewport: PAGE,
		deviceScaleFactor: 2,
	})
	let original: string | null = null
	try {
		await context.route(`${copy[lang].url}**`, (route) =>
			route.fulfill({
				status: 200,
				contentType: "text/html; charset=utf-8",
				body: articlePage(lang),
			}),
		)
		const app = await context.newPage()
		await app.goto(`${appUrl}/login`)
		await app.locator('input[name="email"]').fill(args.email!)
		await app.locator('input[name="password"]').fill(args.password!)
		await app.locator('button[type="submit"]').click()
		await app.waitForURL((u) => !u.pathname.startsWith("/login"))
		await app.goto(`${appUrl}/settings/account`)
		original = await app.locator("#locale").inputValue()
		await setLanguage(app, lang)

		const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
		const extensionId = new URL(sw.url()).host

		const article = await context.newPage()
		await article.goto(copy[lang].url)
		await article.evaluate(() => document.fonts.ready)
		await clickButton(context, extensionId, article)
		const open = article.locator("#klipstack-toast-host a")
		await open.waitFor({ timeout: 30_000 })
		// Past the toast's entrance.
		await article.waitForTimeout(400)
		const saved = await article.screenshot()
		const readUrl = await open.getAttribute("href")
		if (!readUrl) throw new Error("the toast has no link to the saved article")

		await app.bringToFront()
		await app.goto(readUrl)
		await app.locator(".reader-content").getByText(copy[lang].body[0]!.slice(0, 40)).waitFor({
			timeout: 90_000,
		})
		await app.waitForLoadState("networkidle")
		await app.evaluate(() => document.fonts.ready)
		const reader = await app.screenshot()

		await app.goto(`${appUrl}/library`)
		await app.getByText(copy[lang].title).first().waitFor({ timeout: 30_000 })
		await app.evaluate(() => document.fonts.ready)
		const library = await app.screenshot()
		return [saved, reader, library]
	} finally {
		if (original) {
			const page = context.pages()[0] ?? (await context.newPage())
			await setLanguage(page, original).catch((e) => console.error(e))
		}
		await context.close()
	}
}

const icon = readFileSync(resolve(root, "apps/extension/public/icon/32.png")).toString("base64")

/** A capture in a browser window under its caption: the store's 1280×800 picture. */
function frame(shot: Buffer, address: string, [title, line]: string[], button: boolean): string {
	return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Display; src: url(data:font/ttf;base64,${font("600-opsz72")}); }
body { margin: 0; width: 1280px; height: 800px; overflow: hidden; background: #fbfaf7;
	font-family: system-ui, sans-serif; }
.caption { text-align: center; padding-top: 40px; }
h1 { font: 46px/1.1 Display, serif; letter-spacing: -0.02em; color: #1a1d23; margin: 0; }
.line { font-size: 20px; color: #5f646b; margin-top: 12px; }
.window { position: absolute; left: 80px; top: 172px; width: 1120px; height: 680px;
	border-radius: 14px 14px 0 0; overflow: hidden; background: #fff;
	box-shadow: 0 24px 60px rgba(26, 29, 35, 0.18), 0 0 0 1px rgba(26, 29, 35, 0.08); }
.bar { height: 52px; display: flex; align-items: center; gap: 14px; padding: 0 18px;
	background: #eef0f3; border-bottom: 1px solid #dfe2e7; }
.dots { display: flex; gap: 8px; } .dots i { width: 12px; height: 12px; border-radius: 50%;
	background: #d4d7dd; display: block; }
.address { flex: 1; height: 32px; border-radius: 16px; background: #fff; color: #3c4047;
	font-size: 15px; display: flex; align-items: center; padding: 0 16px; }
.ext { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; }
.ext.on { background: #dbe5f5; box-shadow: 0 0 0 2px #3a64a0; }
.ext img { width: 18px; height: 18px; }
.page { display: block; width: 1120px; height: ${PAGE.height}px; }
</style></head><body>
<div class="caption"><h1>${title}</h1><div class="line">${line}</div></div>
<div class="window"><div class="bar"><div class="dots"><i></i><i></i><i></i></div>
<div class="address">${address}</div>
<div class="ext${button ? " on" : ""}"><img src="data:image/png;base64,${icon}" alt=""></div></div>
<img class="page" src="data:image/png;base64,${shot.toString("base64")}" alt=""></div>
</body></html>`
}

execFileSync("pnpm", ["--filter", "@klipstack/extension", "exec", "wxt", "build"], {
	env: { ...process.env, WXT_APP_URL: appUrl, WXT_OUT_DIR: extOut },
	stdio: "inherit",
})

const browser = await chromium.launch()
const composer = await browser.newPage({ viewport: { width: 1280, height: 800 } })
for (const lang of ["en", "es"] as const) {
	const shots = await capture(lang)
	const addresses = [
		copy[lang].url.replace("https://", ""),
		"klipstack.com/read/…",
		"klipstack.com/library",
	]
	for (const [i, shot] of shots.entries()) {
		await composer.setContent(frame(shot, addresses[i]!, copy[lang].captions[i]!, i === 0))
		await composer.evaluate(() => document.fonts.ready)
		const png = await sharp(await composer.screenshot())
			.removeAlpha()
			.png()
			.toBuffer()
		const path = resolve(out, `screenshot-${i + 1}-${lang}.png`)
		writeFileSync(path, png)
		console.log("wrote", path.replace(`${root}/`, ""))
	}
}
await browser.close()
