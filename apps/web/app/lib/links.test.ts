import { expect, it } from "vitest"
import { splitLinks } from "./links"

it("finds a link per line, links separated by spaces, and keeps other lines whole", () => {
	expect(
		splitLinks(
			"  https://a.example/1 \r\n\nhttps://b.example/2 http://c.example/3\nnot a link\nhttps://d.example/4 and more\n",
		),
	).toEqual([
		"https://a.example/1",
		"https://b.example/2",
		"http://c.example/3",
		"not a link",
		"https://d.example/4 and more",
	])
	expect(splitLinks("  \n ")).toEqual([])
})
