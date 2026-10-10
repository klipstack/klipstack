// The part of opentype.js that scripts/icons.ts and the edition card (lib/edition-card.server.ts)
// use. The package ships no types.
declare module "opentype.js/dist/opentype.mjs" {
	export interface BoundingBox {
		x1: number
		y1: number
		x2: number
		y2: number
	}
	export type PathCommand =
		| { type: "M" | "L"; x: number; y: number }
		| { type: "Q"; x1: number; y1: number; x: number; y: number }
		| { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
		| { type: "Z"; x?: undefined; y?: undefined }
	export interface Path {
		commands: PathCommand[]
		getBoundingBox(): BoundingBox
	}
	export interface Font {
		unitsPerEm: number
		ascender: number
		descender: number
		getPath(
			text: string,
			x: number,
			y: number,
			fontSize: number,
			options?: { kerning?: boolean; letterSpacing?: number },
		): Path
		/** The width `text` takes at `fontSize`, kerning included. */
		getAdvanceWidth(text: string, fontSize: number): number
		/** 0 when the font has no glyph for `char`. */
		charToGlyphIndex(char: string): number
	}
	export function parse(buffer: ArrayBuffer): Font
}
