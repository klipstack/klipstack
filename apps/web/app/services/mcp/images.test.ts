import { describe, expect, it } from "vitest"
import { fitForModel } from "./images"

describe("fitForModel", () => {
	it("caps the long edge of a tall image, keeping the aspect ratio", () => {
		expect(fitForModel(400, 4000)).toEqual({ width: 156, height: 1568 })
	})
})
