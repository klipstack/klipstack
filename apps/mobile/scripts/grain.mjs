// Draws the page's paper grain (src/components/paper.tsx) into assets/grain-{light,dark}@3x.png:
// the web's --k-grain (apps/web/app/app.css), the same noise and colors, on a 256-point tile, at 3x only (a 2x screen draws it smaller).
// Run from the repository root after changing the web's grain: node apps/mobile/scripts/grain.mjs
// (sharp comes with apps/web).
import { createRequire } from "node:module"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../..")
const sharp = createRequire(resolve(root, "apps/web/package.json"))("sharp")
const TILE = 256
const COLORS = {
	light: "0 0 0 0 0.35 0 0 0 0 0.28 0 0 0 0 0.2 0 0 0 0.09 0",
	dark: "0 0 0 0 1 0 0 0 0 0.95 0 0 0 0 0.85 0 0 0 0.05 0",
}
for (const [scheme, matrix] of Object.entries(COLORS)) {
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE}' height='${TILE}'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='${matrix}'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`
	for (const scale of [3])
		await sharp(Buffer.from(svg), { density: 72 * scale })
			.png({ palette: true, colours: 64, dither: 0, compressionLevel: 9 })
			.toFile(resolve(root, `apps/mobile/assets/grain-${scheme}@${scale}x.png`))
}
