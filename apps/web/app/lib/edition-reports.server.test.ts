import { createHmac, randomUUID } from "node:crypto"
import { authLimits, db, editionReports, editions, eq, inArray, sql, user } from "@klipstack/db"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { inSnapshot } from "~/test/snapshot"
import { REPORTS_OPEN_MAX, reportEdition } from "./edition-reports.server"
import { env } from "./env.server"
import { FORM_MIN_MS, formToken } from "./invite-requests.server"

const TAG = `reports-${randomUUID().slice(0, 8)}`
const owner = `${TAG}-owner`
const live = { id: "", publicId: "" }
const hidden = { id: "", publicId: "" }
const removed = { id: "", publicId: "" }

const ips: string[] = []
function headers(ip = `${TAG}-${randomUUID()}`) {
	ips.push(ip)
	return new Headers({
		"x-klipstack-client-ip": ip,
		"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(ip)
			.digest("hex"),
	})
}
const limitKey = (kind: "ip" | "account", value: string) =>
	createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(`/report-edition:${kind}:${value}`)
		.digest("hex")

/** A token issued long enough ago to pass the minimum time. */
const aged = () => formToken(Date.now() - FORM_MIN_MS - 1000, "edition-report")

const report = (
	publicId: string,
	extra: { token?: unknown; trap?: unknown; email?: string | null; from?: Headers } = {},
) =>
	reportEdition(
		{
			publicId,
			reason: "spam",
			details: `  ${TAG} details  `,
			email: extra.email,
			locale: "es",
			token: extra.token ?? aged(),
			trap: extra.trap ?? "",
		},
		extra.from ?? headers(),
	)

const stored = (editionId: string) =>
	db.select().from(editionReports).where(eq(editionReports.editionId, editionId))

async function edition(values: Partial<typeof editions.$inferInsert>) {
	const [row] = await db
		.insert(editions)
		.values({
			userId: owner,
			title: "Week",
			locale: "en",
			timeZone: "UTC",
			publishedAt: new Date(),
			...values,
		})
		.returning({ id: editions.id, publicId: editions.publicId })
	return row!
}

beforeAll(async () => {
	await db.insert(user).values({ id: owner, name: "Owner", email: `${owner}@example.com` })
	Object.assign(live, await edition({}))
	Object.assign(hidden, await edition({ unpublishedAt: new Date() }))
	Object.assign(removed, await edition({ removedAt: new Date(), removedGround: "spam" }))
})
afterEach(async () => {
	await db.delete(editionReports).where(inArray(editionReports.editionId, [live.id]))
})
afterAll(async () => {
	await db.delete(user).where(eq(user.id, owner))
	const keys = ips.flatMap((ip) => [
		limitKey("ip", ip),
		...[live, hidden, removed].map((e) => limitKey("account", `${e.publicId}:${ip}`.toLowerCase())),
	])
	await db.delete(authLimits).where(inArray(authLimits.key, keys))
})

describe("reportEdition", () => {
	it("stores a report on a public edition, the address lowered and the text trimmed", async () => {
		expect(await report(live.publicId, { email: ` ${TAG}@Example.com ` })).toBe("received")
		const [row] = await stored(live.id)
		expect(row).toMatchObject({
			reason: "spam",
			details: `${TAG} details`,
			email: `${TAG}@example.com`,
			locale: "es",
			notifiedAt: null,
		})
		await report(live.publicId, { email: "" })
		expect((await stored(live.id)).map((r) => r.email)).toContain(null)
	})

	it("answers bots, and editions that are not public, as it answers everyone, storing nothing", async () => {
		for (const outcome of [
			await report(live.publicId, { trap: "filled" }),
			await report(live.publicId, { token: formToken(Date.now(), "edition-report") }),
			await report(hidden.publicId),
			await report(removed.publicId),
			await report("000000000000"),
		])
			expect(outcome).toBe("received")
		expect(await stored(live.id)).toEqual([])
		expect(await stored(hidden.id)).toEqual([])
		expect(await stored(removed.id)).toEqual([])
	})

	it("asks again for a form too old, forged, or made for the wait list", async () => {
		for (const token of [
			formToken(Date.now() - 25 * 60 * 60 * 1000, "edition-report"),
			"1.abc",
			formToken(Date.now() - FORM_MIN_MS - 1000, "invite-request"),
		])
			expect(await report(live.publicId, { token })).toBe("expired")
		expect(await stored(live.id)).toEqual([])
	})

	it("takes 3 reports an hour on one edition from one address", async () => {
		const from = `${TAG}-${randomUUID()}`
		for (let i = 0; i < 3; i++)
			expect(await report(live.publicId, { from: headers(from) })).toBe("received")
		await expect(report(live.publicId, { from: headers(from) })).rejects.toMatchObject({
			statusCode: 429,
		})
		// Another address still can.
		expect(await report(live.publicId)).toBe("received")
		expect(await stored(live.id)).toHaveLength(4)
	})

	it("counts reports on one edition from one IPv6 /64 together", async () => {
		const hex = () => Math.floor(Math.random() * 0xffff).toString(16)
		const prefix = `2001:db8:${hex()}:${hex()}`
		// The keys this /64 is counted under, for the cleanup.
		ips.push(`${prefix}::/64`)
		for (let i = 0; i < 3; i++)
			expect(await report(live.publicId, { from: headers(`${prefix}::${i + 1}`) })).toBe("received")
		// Well under the /64's 10 an hour: the edition's limit for that /64 refuses it.
		await expect(
			report(live.publicId, { from: headers(`${prefix}:${hex()}:${hex()}:${hex()}:1`) }),
		).rejects.toMatchObject({ statusCode: 429 })
		expect(await stored(live.id)).toHaveLength(3)
	})

	it("says to try later once too many reports wait", async () => {
		// The cap counts every report: filled in a snapshot, so other tests' reports don't come and
		// go meanwhile, and they never see it full.
		const { outcome, rows } = await inSnapshot(async (tx) => {
			const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(editionReports)
			const missing = REPORTS_OPEN_MAX - (open?.n ?? 0)
			if (missing > 0)
				await tx.insert(editionReports).values(
					Array.from({ length: missing }, () => ({
						editionId: live.id,
						reason: "other" as const,
						details: "filler",
						locale: "en",
					})),
				)
			const outcome = await reportEdition(
				{
					publicId: live.publicId,
					reason: "spam",
					details: `${TAG} details`,
					locale: "es",
					token: aged(),
					trap: "",
				},
				headers(),
				tx,
			)
			const rows = await tx
				.select({ id: editionReports.id })
				.from(editionReports)
				.where(eq(editionReports.details, `${TAG} details`))
			return { outcome, rows }
		})
		expect(outcome).toBe("full")
		expect(rows).toHaveLength(0)
	})
})
