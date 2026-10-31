/**
 * Well-known books by their length in words (English editions, roughly), shortest first: a total
 * of words read reads better as a book it outgrew. Names in `library:stats.books`.
 */
const BOOKS = [
	["lottery", 3_400],
	["wallpaper", 6_000],
	["littlePrince", 17_000],
	["metamorphosis", 22_000],
	["oldMan", 27_000],
	["gatsby", 47_000],
	["frankenstein", 75_000],
	["pride", 122_000],
	["mobyDick", 206_000],
	["warAndPeace", 587_000],
] as const

export type Book = (typeof BOOKS)[number][0]

/** The longest book shorter than `words`, or null below the shortest. */
export function longerThan(words: number): Book | null {
	return BOOKS.findLast(([, length]) => words > length)?.[0] ?? null
}
