import { randomUUID } from "node:crypto"
import { account, and, db, eq, inArray, user as userTable } from "@klipstack/db"
import { APIError } from "better-auth/api"
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest"
import { action } from "./settings.sign-in"

// Real users and account rows: the action reads the sign-in methods and deletes provider links
// itself. Only better-auth's own endpoints, the session and the mailer stand in.
const owner = `test-sign-in-${randomUUID()}`
const other = `${owner}-other`

const fixture = vi.hoisted(() => ({
	user: { id: "", email: "owner@example.com", emailVerified: true },
	emailEnabled: true,
	setPassword: vi.fn(),
	changePassword: vi.fn(),
	linkSocialAccount: vi.fn(),
	checkAuthLimit: vi.fn(),
	revoked: [] as { userId: string; links: string[] }[],
}))
vi.mock("~/lib/session.server", () => ({
	requireUser: () => fixture.user,
	cookieHeadersFrom: (headers: Headers) => headers,
}))
vi.mock("~/lib/email.server", () => ({
	get emailEnabled() {
		return fixture.emailEnabled
	},
}))
vi.mock("~/lib/provider-sign-in.server", () => ({
	enabledProvider: (value: unknown) => (value === "github" ? "github" : null),
}))
vi.mock("~/lib/auth-limits.server", () => ({
	checkAuthLimit: fixture.checkAuthLimit,
	withAuthLimitChecked: (fn: () => unknown) => fn(),
}))
// Apple is the process boundary: what the account still had linked when its revocation ran.
vi.mock("~/lib/apple-tokens.server", () => ({
	revokeAppleSignIn: async (userId: string) => {
		const links = await db.select().from(account).where(eq(account.userId, userId))
		fixture.revoked.push({ userId, links: links.map((link) => link.providerId).sort() })
	},
}))
vi.mock("~/lib/auth.server", () => ({
	auth: {
		api: {
			setPassword: fixture.setPassword,
			changePassword: fixture.changePassword,
			linkSocialAccount: fixture.linkSocialAccount,
		},
	},
}))

/** Replaces the user's ways in with these providers ("credential" is a password). */
async function waysIn(userId: string, providers: string[]) {
	await db.delete(account).where(eq(account.userId, userId))
	if (providers.length > 0)
		await db.insert(account).values(
			providers.map((providerId) => ({
				id: randomUUID(),
				accountId: `${providerId}-${userId}`,
				providerId,
				userId,
			})),
		)
}

const providersOf = async (userId: string) =>
	(await db.select({ id: account.providerId }).from(account).where(eq(account.userId, userId)))
		.map((row) => row.id)
		.sort()

const post = (fields: Record<string, string>) =>
	action({
		request: new Request("http://localhost/settings/sign-in", {
			method: "POST",
			body: new URLSearchParams(fields),
		}),
	} as never)

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: owner, name: "Owner", email: `${owner}@example.com` },
		{ id: other, name: "Other", email: `${other}@example.com` },
	])
	fixture.user.id = owner
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [owner, other]))
})

beforeEach(async () => {
	fixture.user.emailVerified = true
	fixture.emailEnabled = true
	await waysIn(owner, [])
	await waysIn(other, ["github"])
	for (const mock of [fixture.setPassword, fixture.linkSocialAccount])
		mock.mockReset().mockResolvedValue(undefined)
	fixture.changePassword.mockReset().mockResolvedValue({ headers: new Headers() })
	fixture.checkAuthLimit.mockReset().mockResolvedValue(undefined)
})

it("adds nothing to an unverified account", async () => {
	fixture.user.emailVerified = false
	const additions: Record<string, string>[] = [
		{ intent: "password", newPassword: "password123" },
		{ intent: "link", provider: "github" },
	]
	for (const fields of additions)
		expect(await post(fields)).toMatchObject({
			data: { result: "unverified" },
			init: { status: 403 },
		})
	expect(fixture.setPassword).not.toHaveBeenCalled()
	expect(fixture.linkSocialAccount).not.toHaveBeenCalled()
})

it("sets a first password without asking for a current one", async () => {
	expect(await post({ intent: "password", newPassword: "password123" })).toEqual({
		result: "password-set",
	})
	expect(fixture.setPassword).toHaveBeenCalledWith(
		expect.objectContaining({ body: { newPassword: "password123" } }),
	)
	expect(fixture.changePassword).not.toHaveBeenCalled()
})

it("changes a password behind the guess limit, and signs other devices out", async () => {
	await waysIn(owner, ["credential"])
	expect(
		await post({
			intent: "password",
			currentPassword: "old-password",
			newPassword: "new-password",
		}),
	).toMatchObject({ data: { result: "password-changed" } })
	expect(fixture.checkAuthLimit).toHaveBeenCalledWith(
		"/change-password",
		"owner@example.com",
		expect.any(Headers),
	)
	expect(fixture.changePassword).toHaveBeenCalledWith(
		expect.objectContaining({
			body: {
				currentPassword: "old-password",
				newPassword: "new-password",
				revokeOtherSessions: true,
			},
		}),
	)
	expect(fixture.setPassword).not.toHaveBeenCalled()

	fixture.changePassword.mockRejectedValue(
		new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Invalid password" }),
	)
	expect(
		await post({ intent: "password", currentPassword: "guess", newPassword: "new-password" }),
	).toMatchObject({ data: { result: "wrong-password" }, init: { status: 400 } })

	fixture.checkAuthLimit.mockRejectedValue(new APIError("TOO_MANY_REQUESTS", { message: "slow" }))
	expect(
		await post({ intent: "password", currentPassword: "guess", newPassword: "new-password" }),
	).toMatchObject({ data: { result: "limited" }, init: { status: 429 } })
})

it("keeps the last way in, and disconnects only this account's provider", async () => {
	await waysIn(owner, ["github"])
	fixture.emailEnabled = false
	expect(await post({ intent: "unlink", provider: "github" })).toMatchObject({
		data: { result: "last-method" },
		init: { status: 409 },
	})
	expect(await providersOf(owner)).toEqual(["github"])

	// A password, another provider or the emailed link each count as another way in.
	for (const [ways, emailEnabled, left] of [
		[["github", "credential"], false, ["credential"]],
		[["github", "google"], false, ["google"]],
		[["github"], true, []],
	] as const) {
		await waysIn(owner, [...ways])
		fixture.emailEnabled = emailEnabled
		expect(await post({ intent: "unlink", provider: "github" })).toEqual({ result: "unlinked" })
		expect(await providersOf(owner)).toEqual(left)
	}
	// The other user's GitHub link was never touched.
	expect(await providersOf(other)).toEqual(["github"])
})

it("disconnects an unverified account's provider too, and nothing it does not have", async () => {
	fixture.user.emailVerified = false
	await waysIn(owner, ["credential", "github"])
	expect(await post({ intent: "unlink", provider: "github" })).toEqual({ result: "unlinked" })
	expect(await providersOf(owner)).toEqual(["credential"])
	expect(await post({ intent: "unlink", provider: "credential" })).toEqual({ result: "unlinked" })
	expect(await providersOf(owner)).toEqual(["credential"])
	expect(
		await db
			.select({ id: account.id })
			.from(account)
			.where(and(eq(account.userId, other), eq(account.providerId, "github"))),
	).toHaveLength(1)
})

it("revokes Sign in with Apple at Apple when Apple is disconnected, before its link goes", async () => {
	await waysIn(owner, ["apple", "credential"])
	fixture.revoked.length = 0
	expect(await post({ intent: "unlink", provider: "apple" })).toEqual({ result: "unlinked" })
	expect(fixture.revoked).toEqual([{ userId: owner, links: ["apple", "credential"] }])
	expect(await providersOf(owner)).toEqual(["credential"])
	// Disconnecting another provider asks Apple nothing.
	await waysIn(owner, ["github", "credential"])
	await post({ intent: "unlink", provider: "github" })
	expect(fixture.revoked).toHaveLength(1)
})
