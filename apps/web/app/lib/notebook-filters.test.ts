import { describe, expect, it } from "vitest"
import {
	notebookHref,
	notebookKeep,
	notebookViewFromCookie,
	parseNotebookFilter,
	showsArticleNotes,
} from "./notebook-filters"

describe("the Notebook's filters", () => {
	it("reads notes, highlights and the colors; nothing else", () => {
		expect(["notes", "highlights", "blue", "purple", null].map(parseNotebookFilter)).toEqual([
			"notes",
			"highlights",
			"blue",
			null,
			null,
		])
	})
	it("shows article notes under all and notes only", () => {
		expect([null, "notes", "highlights", "blue"].map((f) => showsArticleNotes(f as never))).toEqual(
			[true, true, false, false],
		)
	})
	it("reads the view remembered on the device", () => {
		expect(notebookViewFromCookie("a=1; klip_hl_view=stream")).toBe("stream")
		expect(notebookViewFromCookie("klip_hl_view=nonsense")).toBeNull()
	})
})

describe("notebookHref", () => {
	const state = { q: "", filter: null, view: "stream", tag: null, topic: null } as const
	it("names the view always, and the rest when set", () => {
		expect(notebookHref(state)).toBe("/notebook?view=stream")
		expect(
			notebookHref(
				{ ...state, q: "a b", filter: "highlights", tag: "t1", topic: "p1" },
				{ view: "articles" },
			),
		).toBe("/notebook?q=a+b&show=highlights&tag=t1&topic=p1&view=articles")
	})
	it("drops the topic for the topics view, which shows them all", () => {
		expect(notebookHref({ ...state, topic: "p1" }, { view: "topics" })).toBe(
			"/notebook?view=topics",
		)
		expect(notebookKeep({ ...state, view: "topics", topic: "p1", tag: "t" })).toEqual({
			view: "topics",
			tag: "t",
		})
	})
	it("deals a hand instead of a view, and pages the stream", () => {
		expect(notebookHref({ ...state, filter: "blue" }, { shuffle: "new" })).toBe(
			"/notebook?show=blue&shuffle=new",
		)
		expect(notebookHref(state, { cursor: "abc" })).toBe("/notebook?view=stream&cursor=abc")
	})
})
