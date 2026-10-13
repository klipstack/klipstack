import { readFileSync } from "node:fs"
import { HIGHLIGHT_COLORS } from "@klipstack/api-contract/enums"
import { describe, expect, it } from "vitest"
import { growingFit, NOTE_PAPER, postItChars, tiltDegrees, tiltFor } from "./post-it"

describe("postItChars", () => {
	it("makes a short note a small square, and a long one a balanced rectangle, within bounds", () => {
		expect(postItChars("")).toBe(14)
		expect(postItChars("Yes")).toBe(14)
		// √(4 × 400) = 40: wider than the shortest, not yet the widest.
		expect(postItChars("a".repeat(400))).toBe(40)
		expect(postItChars("a".repeat(5000))).toBe(52)
	})

	it("reads a link as its title, and a line break as a line of its own", () => {
		const link = "[A title](/read/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b)"
		expect(postItChars(`${"a".repeat(100)} ${link}`)).toBe(
			postItChars(`${"a".repeat(100)} A title`),
		)
		expect(postItChars("a\nb\nc\nd\ne\nf\ng\nh\ni")).toBeGreaterThan(postItChars("abcdefghi"))
	})
})

describe("tiltDegrees", () => {
	it("leans neighbors apart, comes round again, and leans compact notes barely", () => {
		expect(Math.sign(tiltDegrees(0))).not.toBe(Math.sign(tiltDegrees(1)))
		expect(tiltDegrees(4)).toBe(tiltDegrees(0))
		expect(tiltDegrees(-1)).toBe(tiltDegrees(3))
		for (const n of [0, 1, 2, 3]) expect(Math.abs(tiltDegrees(n, "compact"))).toBeLessThan(1)
	})

	it("leans a note by its id the same way every time", () => {
		expect(tiltFor("0190a1b2")).toBe(tiltFor("0190a1b2"))
		expect(new Set(["a", "b", "c", "d"].map((id) => tiltDegrees(tiltFor(id)))).size).toBe(4)
	})
})

describe("growingFit", () => {
	it("grows with the text and never shrinks under the caret", () => {
		expect(growingFit("Short", "Shorter")).toBe("Shorter")
		expect(growingFit("A longer note", "A lo")).toBe("A longer note")
	})
})

/** sRGB channels, 0 to 1, of `#rrggbb` or `#rrggbbaa`; and its alpha. */
const rgba = (hex: string) => {
	const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255
	return { rgb: [n(1), n(3), n(5)], alpha: hex.length > 7 ? n(7) : 1 }
}
const luminance = (rgb: number[]) => {
	const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
/** WCAG's contrast of `ink` (perhaps translucent) written on opaque `paper`. */
const contrast = (ink: string, paper: string) => {
	const under = rgba(paper).rgb
	const { rgb, alpha } = rgba(ink)
	const [a, b] = [
		luminance(rgb.map((c, i) => c * alpha + under[i]! * (1 - alpha))),
		luminance(under),
	]
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
/** oklch to sRGB `#rrggbb` (Björn Ottosson's matrices). */
const oklchHex = (l: number, c: number, h: number) => {
	const [a, b] = [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
	const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
	return [
		4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
		-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
		-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
	].map((x) => {
		const v = Math.min(1, Math.max(0, x))
		return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255)
	})
}

describe("NOTE_PAPER", () => {
	const modes = ["light", "dark"] as const

	it("every color's ink reads on its paper (WCAG AA), and its placeholder too, in light and dark", () => {
		for (const mode of modes)
			for (const color of HIGHLIGHT_COLORS) {
				const { paper, fg, placeholder } = NOTE_PAPER[mode][color]
				expect(contrast(fg, paper), `${mode} ${color}`).toBeGreaterThanOrEqual(4.5)
				expect(contrast(placeholder, paper), `${mode} ${color}`).toBeGreaterThanOrEqual(3)
			}
	})

	it("each color is a paper of its own", () => {
		for (const mode of modes)
			expect(new Set(HIGHLIGHT_COLORS.map((c) => NOTE_PAPER[mode][c].paper)).size).toBe(5)
	})

	it("is the web's paper (app.css), light and dark", () => {
		const css = readFileSync(new URL("../../../web/app/app.css", import.meta.url), "utf8")
		// The light tokens, the system's dark mode, and the dark theme chosen in Settings.
		const systemDark = css.indexOf("@media (prefers-color-scheme: dark)")
		const chosenDark = css.indexOf(':root[data-theme="dark"] {')
		const blocks = [
			["light", css.slice(css.indexOf(":root {"), systemDark)],
			["dark", css.slice(systemDark, chosenDark)],
			["dark", css.slice(chosenDark)],
		] as const
		for (const [mode, block] of blocks)
			for (const color of HIGHLIGHT_COLORS) {
				const name = color === "yellow" ? "--k-note" : `--k-note-${color}`
				for (const [token, hex] of [
					[name, NOTE_PAPER[mode][color].paper],
					[`${name}-fg`, NOTE_PAPER[mode][color].fg],
				] as const) {
					const m = new RegExp(`${token}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(block)
					expect(m, `${mode} ${token}`).not.toBeNull()
					const web = oklchHex(Number(m![1]), Number(m![2]), Number(m![3]))
					rgba(hex).rgb.forEach((c, i) =>
						expect(Math.abs(c * 255 - web[i]!), `${mode} ${token}`).toBeLessThanOrEqual(1),
					)
				}
			}
	})
})
