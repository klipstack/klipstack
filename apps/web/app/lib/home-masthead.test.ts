import { describe, expect, it } from "vitest"
import { editionEar, mastheadDate, partOfDay } from "./home-masthead"

describe("partOfDay", () => {
	// 2026-10-14 at 11:30 UTC: 08:30 in Santiago, 13:30 in Madrid, 20:30 in Tokyo.
	const now = new Date("2026-10-14T11:30:00Z")

	it("goes by the reader's time zone, not the server's", () => {
		expect(partOfDay(now, "America/Santiago")).toBe("morning")
		expect(partOfDay(now, "Europe/Madrid")).toBe("afternoon")
		expect(partOfDay(now, "Asia/Tokyo")).toBe("evening")
	})

	it("turns at 5, 12 and 19, and keeps the night in the evening", () => {
		const at = (time: string) => partOfDay(new Date(`2026-10-14T${time}Z`), "UTC")
		expect(at("04:59:00")).toBe("evening")
		expect(at("05:00:00")).toBe("morning")
		expect(at("11:59:00")).toBe("morning")
		expect(at("12:00:00")).toBe("afternoon")
		expect(at("18:59:00")).toBe("afternoon")
		expect(at("19:00:00")).toBe("evening")
		expect(at("00:00:00")).toBe("evening")
	})
})

describe("mastheadDate", () => {
	it("prints the reader's day, in their language, capitalized", () => {
		// Already the 15th in Tokyo, still the 14th in Santiago.
		const now = new Date("2026-10-14T20:00:00Z")
		expect(mastheadDate(now, "en", "America/Santiago")).toBe("Wednesday, October 14, 2026")
		expect(mastheadDate(now, "es", "Asia/Tokyo")).toBe("Jueves, 15 de octubre de 2026")
	})
})

describe("editionEar", () => {
	it("tells of the draft in progress before the articles marked", () => {
		expect(editionEar({ marked: 3, draft: { items: 0 } })).toEqual({ draft: true, count: 0 })
		expect(editionEar({ marked: 3, draft: null })).toEqual({ draft: false, count: 3 })
	})

	it("says nothing without a draft or anything marked", () => {
		expect(editionEar({ marked: 0, draft: null })).toBeNull()
	})
})
