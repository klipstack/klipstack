import type { getMe } from "@klipstack/api-contract"
import { db, eq, user as userTable } from "@klipstack/db"
import { oauthClientName } from "../auth.server"
import { unauthorized } from "../errors.server"
import type { Handler } from "../handler.server"

export const me: Handler<typeof getMe> = async ({ principal }) => {
	const [user] = await db
		.select({ id: userTable.id, name: userTable.name, email: userTable.email })
		.from(userTable)
		.where(eq(userTable.id, principal.userId))
		.limit(1)
	if (!user) throw unauthorized("This account no longer exists.", true)
	return {
		...user,
		access: principal.access,
		via: principal.via,
		client: principal.clientId
			? { id: principal.clientId, name: await oauthClientName(principal.clientId) }
			: null,
	}
}
