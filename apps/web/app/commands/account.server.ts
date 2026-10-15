import { Id, NUL_REFUSED, withoutNul } from "@klipstack/api-contract"
import { db, eq, type UserPrefs, user as userTable } from "@klipstack/db"
import { supportedLanguages } from "@klipstack/i18n"
import { z } from "zod"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import { signedInRecently } from "~/lib/recent-sign-in.server"
import { deleteAccount as deleteEverything } from "~/services/account.server"
import { createApiKey as insertApiKey, revokeApiKey as revokeKey } from "~/services/api-keys.server"
import { disconnectApp as removeConsent } from "~/services/oauth-apps.server"

/**
 * The account's settings and access: API keys, connected apps, the profile, reading preferences,
 * and deleting the account. Access that outlives the session (a key) and deleting the account need
 * a recent sign-in: `signedInAt` is the session's.
 */

const reauthenticate = () => new AppError("reauthentication_required", "Sign in again to continue.")

/** A new API key for the user, returned once; it needs a verified email and a recent sign-in. */
export async function createApiKey(
	userId: string,
	input: { name: string; signedInAt: Date | string | null | undefined },
) {
	const name = parseInput(
		z.string().trim().min(1).max(60).refine(withoutNul, NUL_REFUSED),
		input.name,
	)
	const [owner] = await db
		.select({ verified: userTable.emailVerified })
		.from(userTable)
		.where(eq(userTable.id, userId))
	if (!owner?.verified)
		throw new AppError(
			"verification_required",
			"Verify your email before creating an API key or connecting an app.",
		)
	if (!signedInRecently(input.signedInAt)) throw reauthenticate()
	return insertApiKey(userId, name)
}

export async function revokeApiKey(userId: string, id: string) {
	if (!(await revokeKey(userId, parseInput(Id, id)))) throw notFound("No API key with that id.")
}

/** Removes an app's access (`consentId`: any of its consents, as Settings lists them). */
export async function disconnectApp(userId: string, consentId: string) {
	const id = parseInput(z.string().min(1).max(200), consentId)
	if (!(await removeConsent(userId, id))) throw notFound("No connected app with that id.")
}

/**
 * Deletes the account and everything in it. `confirmEmail` must be the account's email, whatever its
 * case (`invalid_request` otherwise, with `details.field`).
 */
export async function deleteAccount(
	userId: string,
	input: {
		confirmEmail: string
		signedInAt: Date | string | null | undefined
		/** Runs once the checks passed, before anything is deleted (the web signs out there). */
		beforeDelete?: () => Promise<void>
	},
) {
	const [account] = await db
		.select({ email: userTable.email })
		.from(userTable)
		.where(eq(userTable.id, userId))
	if (!account) throw notFound("No such account.")
	if (input.confirmEmail.trim().toLowerCase() !== account.email.toLowerCase())
		throw new AppError("invalid_request", "Type the account's email to confirm.", {
			details: { field: "confirmEmail" },
		})
	if (!signedInRecently(input.signedInAt)) throw reauthenticate()
	await input.beforeDelete?.()
	await deleteEverything(userId)
}

const Profile = z.object({
	name: z.string().trim().min(1).max(100).refine(withoutNul, NUL_REFUSED),
	locale: z.enum(supportedLanguages),
})

export async function updateProfile(userId: string, input: z.input<typeof Profile>) {
	const profile = parseInput(Profile, input)
	await db.update(userTable).set(profile).where(eq(userTable.id, userId))
	return profile
}

const Prefs = z.object({
	font: z.enum(["serif", "sans", "dyslexic"]).optional(),
	fontSize: z.enum(["sm", "md", "lg", "xl"]).optional(),
	width: z.enum(["narrow", "normal", "wide"]).optional(),
	theme: z.enum(["system", "light", "dark"]).optional(),
	shortcuts: z.enum(["on", "off"]).optional(),
	linkEditions: z.enum(["on", "off"]).optional(),
	outline: z.enum(["on", "off"]).optional(),
})

/** Merges preferences into the user's; the result. */
export async function setPrefs(userId: string, input: z.input<typeof Prefs>): Promise<UserPrefs> {
	const patch = parseInput(Prefs, input)
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ prefs: userTable.prefs })
			.from(userTable)
			.where(eq(userTable.id, userId))
			.for("update")
		const prefs: UserPrefs = { ...((row?.prefs ?? {}) as UserPrefs), ...patch }
		await tx.update(userTable).set({ prefs }).where(eq(userTable.id, userId))
		return prefs
	})
}
