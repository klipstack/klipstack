import { describe, expect, it } from "vitest"
import {
	LINK_LOOKING,
	linkStale,
	parseShareTab,
	type PublicLink,
	type PublicLinkEvent,
	publicLinkTransition,
	shownTab,
} from "./share-highlight"

const live = {
	removed: false,
	publicId: "abc",
	url: "u",
	includeNote: true,
	changed: false,
} as const

describe("the Share sheet", () => {
	it("opens on Link for a highlight with a live link, until another tab is chosen", () => {
		expect(shownTab(live, "image", false)).toBe("link")
		expect(shownTab(live, "image", true)).toBe("image")
		expect(shownTab({ removed: true }, "image", false)).toBe("image")
		expect(shownTab(null, "text", false)).toBe("text")
		// Still looking: the tab chosen last.
		expect(shownTab(undefined, "image", false)).toBe("image")
	})

	it("remembers Link and Image, and starts on Text otherwise", () => {
		expect(parseShareTab('"image"')).toBe("image")
		expect(parseShareTab('"link"')).toBe("link")
		expect(parseShareTab(null)).toBe("text")
		expect(parseShareTab('"square"')).toBe("text")
		expect(parseShareTab("{oops")).toBe("text")
	})

	it("offers an update when the highlight changed, or the note choice differs from the page's", () => {
		expect(linkStale(live, true)).toBe(false)
		expect(linkStale(live, false)).toBe(true)
		expect(linkStale({ ...live, changed: true }, true)).toBe(true)
		expect(linkStale({ removed: true }, false)).toBe(false)
		expect(linkStale(null, true)).toBe(false)
	})
})

describe("the public link", () => {
	const run = (state: PublicLink, ...events: PublicLinkEvent[]) =>
		events.reduce(publicLinkTransition, state)
	const shared = run(LINK_LOOKING, { type: "found", share: live })

	it("changes one thing at a time: a second tap while one runs changes nothing", () => {
		const busy = run(shared, { type: "start" })
		expect(busy).toMatchObject({ busy: true, error: null })
		expect(publicLinkTransition(busy, { type: "start" })).toBe(busy)
		// Done, the next change can start.
		const done = run(busy, { type: "done", share: live })
		expect(done).toMatchObject({ busy: false, share: live })
		expect(run(done, { type: "start" }).busy).toBe(true)
	})

	it("keeps a change made while the link was looked up, over the lookup's older answer", () => {
		const made = run(LINK_LOOKING, { type: "start" }, { type: "done", share: live })
		expect(run(made, { type: "found", share: null }).share).toEqual(live)
		const making = run(LINK_LOOKING, { type: "start" })
		expect(
			run(making, { type: "found", share: null }, { type: "done", share: live }).share,
		).toEqual(live)
	})

	it("counts a link stopped elsewhere as stopped, and a removed one as removed", () => {
		const gone = run(shared, { type: "start" }, { type: "failed", stop: true, code: "not_found" })
		expect(gone).toMatchObject({ share: null, busy: false, error: null })
		const removed = run(
			shared,
			{ type: "start" },
			{ type: "failed", stop: false, code: "share_removed" },
		)
		expect(removed).toMatchObject({ share: { removed: true }, error: "share_removed" })
		const failed = run(shared, { type: "start" }, { type: "failed", stop: false, code: null })
		expect(failed).toMatchObject({ share: live, busy: false, error: "failed" })
	})
})
