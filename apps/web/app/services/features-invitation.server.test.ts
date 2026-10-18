import { randomUUID } from "node:crypto"
import { db, eq, sql, topicLibraries, user as userTable, userFeatures } from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const { endFeaturesInvitation, setPrefs } = await import("~/commands/account.server")
const { disableTopics, enableTopics } = await import("~/commands/topics.server")
const { featuresInvitation } = await import("./features-invitation.server")
const { topicModels } = await import("~/lib/ai.server")

const tag = `test-features-invitation-${randomUUID().slice(0, 8)}`
let userId: string
let otherId: string

beforeEach(async () => {
	userId = `${tag}-${randomUUID().slice(0, 8)}`
	otherId = `${userId}-other`
	await db.insert(userTable).values([
		{ id: userId, name: "Reader", email: `${userId}@example.com` },
		{ id: otherId, name: "Other", email: `${otherId}@example.com` },
	])
})
afterAll(async () => {
	await db.delete(userTable).where(sql`${userTable.id} like ${`${tag}%`}`)
	await stopBoss()
})

describe("The sidebar's invitation to Settings → Features", () => {
	it("is there for a new account, offering topics only where it can turn them on", async () => {
		expect(await featuresInvitation(userId)).toEqual({ topics: false })
		await db.insert(userFeatures).values({ userId, feature: "topics" })
		expect(await featuresInvitation(userId)).toEqual({ topics: true })

		// A server without both model keys has no topics to offer.
		const available = vi.spyOn(topicModels, "available", "get").mockReturnValue(false)
		try {
			expect(await featuresInvitation(userId)).toEqual({ topics: false })
		} finally {
			available.mockRestore()
		}
	})

	it("ends for good once closed or the page opened: nobody else's", async () => {
		await endFeaturesInvitation(userId)
		expect(await featuresInvitation(userId)).toBeNull()
		expect(await featuresInvitation(otherId)).toEqual({ topics: false })
	})

	it("ends for good once a feature is turned on, either one, even if it is turned off again", async () => {
		await setPrefs(userId, { feeds: "off", font: "sans" })
		expect(await featuresInvitation(userId)).toEqual({ topics: false })
		await setPrefs(userId, { editions: "on" })
		await setPrefs(userId, { editions: "off" })
		expect(await featuresInvitation(userId)).toBeNull()

		await setPrefs(otherId, { feeds: "on" })
		await setPrefs(otherId, { feeds: "off" })
		expect(await featuresInvitation(otherId)).toBeNull()
	})

	it("ends for good once topics are turned on, from anywhere", async () => {
		await db.insert(userFeatures).values({ userId, feature: "topics" })
		await enableTopics(userId)
		await disableTopics(userId)
		expect(await featuresInvitation(userId)).toBeNull()
	})

	it("is not there for an account that turned a feature on before it existed", async () => {
		// Prefs written before the invitation, so without its end.
		const on = (prefs: object) =>
			db
				.update(userTable)
				.set({ prefs: sql`${userTable.prefs} || ${JSON.stringify(prefs)}::jsonb` })
				.where(eq(userTable.id, userId))
		await on({ feeds: "on" })
		expect(await featuresInvitation(userId)).toBeNull()
		await on({ feeds: "off", editions: "on" })
		expect(await featuresInvitation(userId)).toBeNull()
		await on({ editions: "off" })
		expect(await featuresInvitation(userId)).toEqual({ topics: false })

		await db.insert(userFeatures).values({ userId, feature: "topics" })
		await db.insert(topicLibraries).values({ userId })
		expect(await featuresInvitation(userId)).toBeNull()
	})

	it("keeps the first time it ended", async () => {
		vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z"), toFake: ["Date"] })
		try {
			await endFeaturesInvitation(userId)
			vi.setSystemTime(new Date("2026-02-01T00:00:00Z"))
			await setPrefs(userId, { feeds: "on" })
			await endFeaturesInvitation(userId)
		} finally {
			vi.useRealTimers()
		}
		expect(await endedAt(userId)).toBe("2026-01-01T00:00:00.000Z")
	})
})

async function endedAt(id: string) {
	const [row] = await db
		.select({ prefs: userTable.prefs })
		.from(userTable)
		.where(eq(userTable.id, id))
	return (row?.prefs as { featuresInvitationEndedAt?: string } | null)?.featuresInvitationEndedAt
}
