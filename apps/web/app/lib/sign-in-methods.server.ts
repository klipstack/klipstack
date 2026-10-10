import { account, db, eq } from "@klipstack/db"

/** The ways into an account besides the emailed link, which every account has where email works. */
export async function signInMethods(userId: string) {
	const rows = await db
		.select({ providerId: account.providerId })
		.from(account)
		.where(eq(account.userId, userId))
	const ids = rows.map((row) => row.providerId)
	return {
		hasPassword: ids.includes("credential"),
		linked: ids.filter((id) => id !== "credential"),
	}
}
