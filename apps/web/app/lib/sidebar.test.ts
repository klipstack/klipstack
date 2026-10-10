import { describe, expect, it } from "vitest"
import { parseSidebarCookie } from "./sidebar"

describe("parseSidebarCookie", () => {
	it("understands the values written before widths existed, and ignores junk", () => {
		expect(parseSidebarCookie("klip_sidebar=rail")).toEqual({ collapsed: true, width: 240 })
		expect(parseSidebarCookie("klip_sidebar=full")).toEqual({ collapsed: false, width: 240 })
		expect(parseSidebarCookie("klip_sidebar=wide!")).toEqual({ collapsed: false, width: 240 })
	})
})
