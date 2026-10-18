import { afterAll, afterEach, describe, expect, it } from "vitest"
import { env } from "~/lib/env.server"
import { adminFixtures } from "~/test/admin-fixtures"
import { loader } from "./app-layout"
import { action as endInvitation } from "./settings.features"

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

describe("The sidebar's way to Settings → Features", () => {
	it("shows for a new account, and goes for good once the Features page ends it", async () => {
		const reader = await fx.account()
		const layout = async () =>
			(
				await loader({
					request: new Request(new URL("/library", env.APP_URL)),
					context: await fx.routerContext(reader),
				} as never)
			).featuresInvitation
		expect(await layout()).toEqual({ topics: false })

		const end = async (intent: string) =>
			endInvitation({
				request: fx.post("/settings/features", { intent }),
				context: await fx.routerContext(reader),
			} as never)
		expect(await end("something-else")).toMatchObject({ data: { ok: false } })
		expect(await layout()).toEqual({ topics: false })
		await end("end-invitation")
		expect(await layout()).toBeNull()
	})
})
