import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { BrandLogo, BrandLogoSmall } from "./brand-mark"

describe("the brand logos", () => {
	it("are named for screen readers", () => {
		for (const Logo of [BrandLogo, BrandLogoSmall])
			expect(renderToStaticMarkup(<Logo />)).toMatch(/<svg [^>]*role="img" aria-label="Klipstack"/)
	})
})
