import { describe, expect, it } from "vitest"
import { decodeCursor, encodeCursor } from "./admin-cursor.server"

const ID = "01a0b464-23ca-75d8-b26d-fd061f1e3198"
const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

describe("admin list cursors", () => {
	it("round-trips a timestamp as PostgreSQL prints it", () => {
		for (const at of ["2026-09-18 07:42:52.977123+00", "2026-09-18 07:42:52+05:30"])
			expect(decodeCursor(encodeCursor({ at, id: ID }))).toEqual({ at, id: ID })
	})

	it("starts from the top for anything the database would refuse to cast", () => {
		for (const value of [
			null,
			"",
			"not-base64url-json",
			raw({ at: "x" }),
			raw(["2026-09-18 07:42:52+00"]),
			raw(["9999999999", ID]),
			raw(["2026-02-30 00:00:00+00", ID]),
			raw(["2026-13-01 00:00:00+00", ID]),
			raw(["2026-09-18 24:00:00+00", ID]),
			raw(["2026-09-18 07:42:52+00'; drop table invites;--", ID]),
			raw(["2026-09-18 07:42:52+00", "not-a-uuid"]),
			raw(["2026-09-18 07:42:52+00", 7]),
			"A".repeat(301),
		])
			expect(decodeCursor(value)).toBeNull()
	})

	it("accepts a text ID only where the list's IDs are text", () => {
		const cursor = raw(["2026-09-18 07:42:52+00", "user_abc:123"])
		expect(decodeCursor(cursor)).toBeNull()
		expect(decodeCursor(cursor, "text")?.id).toBe("user_abc:123")
		expect(decodeCursor(raw(["2026-09-18 07:42:52+00", "a b"]), "text")).toBeNull()
	})
})
