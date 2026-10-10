import { expect, it } from "vitest"
import { z } from "zod"
import { parseForm } from "./forms"

it("does not reflect passwords or undeclared fields after validation fails", () => {
	const form = new FormData()
	form.set("email", "invalid")
	form.set("password", "secret-password")
	form.set("padding", "unexpected")
	const result = parseForm(form, z.object({ email: z.email(), password: z.string() }))
	expect(result.ok).toBe(false)
	if (!result.ok) expect(result.values).toEqual({ email: "invalid" })
})
