import { afterAll, afterEach, describe, expect, it } from "vitest"
import { env } from "~/lib/env.server"
import { adminFixtures } from "~/test/admin-fixtures"
import { loader } from "./app-layout"
import { action as onboarding } from "./onboarding"

const fx = adminFixtures("app-layout")
afterAll(fx.cleanup)

const configured = env.SUPPYHQ_TENANT
afterEach(() => Object.assign(env, { SUPPYHQ_TENANT: configured }))

async function supportFor(who: Awaited<ReturnType<typeof fx.account>>) {
	const data = await loader({
		request: new Request(new URL("/library", env.APP_URL)),
		context: await fx.routerContext(who),
	} as never)
	return data.support
}

describe("Contact support in the app's sidebar", () => {
	it("shows for a reader on a server with a SuppyHQ account, and never for an admin", async () => {
		Object.assign(env, { SUPPYHQ_TENANT: "example" })
		expect(await supportFor(await fx.account())).toEqual({ tenant: "example" })
		expect(await supportFor(await fx.account({ role: "admin" }))).toBeNull()
	})

	it("is not there on a server without one", async () => {
		Object.assign(env, { SUPPYHQ_TENANT: undefined })
		expect(await supportFor(await fx.account())).toBeNull()
	})
})

describe("The sidebar's Getting started card", () => {
	it("offers the extension only to Chromium on a computer, and goes for good once closed", async () => {
		const reader = await fx.account()
		const layout = async (headers: Record<string, string> = {}) =>
			(
				await loader({
					request: new Request(new URL("/library", env.APP_URL), { headers }),
					context: await fx.routerContext(reader),
				} as never)
			).gettingStarted
		const chrome = {
			"sec-ch-ua": '"Chromium";v="140", "Google Chrome";v="140"',
			"sec-ch-ua-mobile": "?0",
		}
		const appUrl = env.APP_URL
		try {
			Object.assign(env, { APP_URL: "https://klipstack.com" })
			expect((await layout(chrome))?.steps.extension).toBe(false)
			expect((await layout(chrome))?.extensionUrl).toBe("https://klipstack.com/extension")
			// Firefox and Safari send no client hints; a phone says ?1.
			expect((await layout())?.steps.extension).toBeNull()
			expect((await layout({ ...chrome, "sec-ch-ua-mobile": "?1" }))?.steps.extension).toBeNull()
			// Another server: the store's extension does not save to it.
			Object.assign(env, { APP_URL: "https://reader.example.com" })
			expect((await layout(chrome))?.steps.extension).toBeNull()
		} finally {
			Object.assign(env, { APP_URL: appUrl })
		}
		expect((await layout())?.guide).toBe("guide-en")

		await onboarding({
			request: fx.post("/onboarding", { intent: "end-card" }),
			context: await fx.routerContext(reader),
		} as never)
		expect(await layout()).toBeNull()
	})
})
