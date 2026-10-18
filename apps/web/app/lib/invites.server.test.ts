import { createHmac } from "node:crypto"
import { db, eq, invites, sql, user } from "@klipstack/db"
import { afterAll, expect, it } from "vitest"
import { auth } from "./auth.server"
import { env } from "./env.server"
import { listFeatures } from "./features.server"
import { createInvite, signupWithInvite } from "./invites.server"

const suffix = crypto.randomUUID()
const emails = [0, 1, 2, 3, 4].map((i) => `invite-${suffix}-${i}@example.com`)
const codes: string[] = []
const testHeaders = new Headers({
	"x-klipstack-client-ip": suffix,
	"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(suffix)
		.digest("hex"),
})
const create = (email: string) =>
	auth.api.signUpEmail({
		headers: testHeaders,
		body: { name: "Invite", email, password: "password123" },
		returnHeaders: true,
	})
afterAll(async () => {
	// `createInvite` writes an audit event, which would outlive the invite it names.
	await db.execute(sql`
		delete from admin_audit_events where target_id in (
			select id::text from invites where code = any(${sql.param(codes)}::text[]))`)
	for (const code of codes) await db.delete(invites).where(eq(invites.code, code))
	for (const email of emails) await db.delete(user).where(eq(user.email, email))
})

it("creates exactly one account and session from concurrent claims on one invite", async () => {
	const code = await createInvite()
	codes.push(code)
	const results = await Promise.allSettled(
		emails.slice(0, 2).map((email) => signupWithInvite(code, () => create(email))),
	)
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
	let users = 0
	for (const email of emails.slice(0, 2))
		users += (await db.select().from(user).where(eq(user.email, email))).length
	expect(users).toBe(1)
	const winner = results.find((r) => r.status === "fulfilled")!
	if (winner.status === "fulfilled") {
		const headers = new Headers({
			cookie: winner.value.headers
				.getSetCookie()
				.map((c) => c.split(";")[0])
				.join("; "),
		})
		expect((await auth.api.getSession({ headers }))?.user.id).toBe(winner.value.response.user.id)
	}
})

it("rolls back the account if work fails after auth creation, leaving the invite usable", async () => {
	const code = await createInvite()
	codes.push(code)
	await expect(
		signupWithInvite(code, async () => {
			await create(emails[2]!)
			throw new Error("simulate failure before consumption")
		}),
	).rejects.toThrow("simulate failure")
	expect(await db.select().from(user).where(eq(user.email, emails[2]!))).toHaveLength(0)
	const { response } = await signupWithInvite(code, () => create(emails[2]!))
	expect(response.user.email).toBe(emails[2])
	// The sign-up's flags came with it.
	expect(await listFeatures(response.user.id)).toEqual(["ai", "topics"])
})

it("rejects expired invites and releases a claim after a duplicate-email failure", async () => {
	await db
		.insert(user)
		.values({ id: `invite-existing-${suffix}`, email: emails[4]!, name: "Existing" })
	const expired = await createInvite()
	codes.push(expired)
	await db
		.update(invites)
		.set({ expiresAt: new Date(0) })
		.where(eq(invites.code, expired))
	await expect(signupWithInvite(expired, () => create(emails[3]!))).rejects.toMatchObject({
		statusCode: 403,
	})
	const code = await createInvite()
	codes.push(code)
	await expect(signupWithInvite(code, () => create(emails[4]!))).rejects.toMatchObject({
		statusCode: 422,
	})
	expect((await signupWithInvite(code, () => create(emails[3]!))).response.user.email).toBe(
		emails[3],
	)
	await db.delete(user).where(eq(user.email, emails[3]!))
	await expect(signupWithInvite(code, () => create(emails[3]!))).rejects.toMatchObject({
		statusCode: 403,
	})
})
