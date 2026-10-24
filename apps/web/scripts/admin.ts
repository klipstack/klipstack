import { parseArgs } from "node:util"
import { pool } from "@klipstack/db"
import { AppError } from "../app/lib/app-error"
import {
	deleteAccountAsOperator,
	resetTwoFactorAsOperator,
} from "../app/services/admin-accounts.server"
import { changeRole, listAdmins } from "../app/services/admin-roles.server"

/**
 * Grants and revokes the admin role, and deletes an account. The only way to do any of them:
 * there is no web endpoint.
 *
 *   pnpm --filter @klipstack/web admin list
 *   pnpm --filter @klipstack/web admin grant --email owner@example.com --reason "Initial operator"
 *   pnpm --filter @klipstack/web admin revoke --user-id <id> --reason "Access removed"
 *   pnpm --filter @klipstack/web admin delete-account --email someone@example.com \
 *     --confirm someone@example.com --reason "Phishing editions, removed twice"
 *   pnpm --filter @klipstack/web admin reset-two-factor --email someone@example.com \
 *     --reason "Lost phone and backup codes; confirmed by reply from the address"
 *
 * A grant needs an existing, verified account. Either change ends that account's browser
 * sessions. Revoking the last admin is allowed: this script is the way back. Deleting is not
 * undoable, and refuses an admin's account (docs/self-hosting/admin.md, "Stopping an account").
 * Removing two-factor authentication ends the account's sessions too; check first that the
 * request comes from the account's owner (docs/self-hosting/admin.md, "Two-factor authentication").
 */
const USAGE = [
	'usage: admin list | admin grant|revoke (--email <email> | --user-id <id>) --reason "<why>"',
	'       admin delete-account (--email <email> | --user-id <id>) --confirm <its email> --reason "<why>"',
	'       admin reset-two-factor (--email <email> | --user-id <id>) --reason "<why>"',
].join("\n")

async function main(): Promise<number> {
	let command: string | undefined
	let values: { email?: string; "user-id"?: string; reason?: string; confirm?: string }
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			allowPositionals: true,
			options: {
				email: { type: "string" },
				"user-id": { type: "string" },
				reason: { type: "string" },
				confirm: { type: "string" },
			},
		})
		if (parsed.positionals.length !== 1) throw new Error("one command expected")
		command = parsed.positionals[0]
		values = parsed.values
	} catch {
		console.error(USAGE)
		return 2
	}

	if (command === "list") {
		if (values.email || values["user-id"] || values.reason || values.confirm) {
			console.error(USAGE)
			return 2
		}
		const admins = await listAdmins()
		if (!admins.length) console.log("no admins")
		for (const admin of admins)
			console.log(
				`${admin.id}\t${admin.email}\t${admin.name}\t${admin.emailVerified ? "verified" : "UNVERIFIED"}`,
			)
		return 0
	}

	const email = values.email
	const userId = values["user-id"]
	if (command === "delete-account") {
		if (!values.reason?.trim() || !values.confirm || Boolean(email) === Boolean(userId)) {
			console.error(USAGE)
			return 2
		}
		try {
			const deleted = await deleteAccountAsOperator(
				email ? { email } : { userId: userId as string },
				{ confirm: values.confirm, reason: values.reason },
			)
			console.log(`${deleted.userId}: deleted, with everything in it`)
			return 0
		} catch (error) {
			if (error instanceof AppError) {
				console.error(error.message)
				return 1
			}
			console.error(`deletion failed: ${error instanceof Error ? error.name : typeof error}`)
			return 1
		}
	}
	if (command === "reset-two-factor") {
		if (!values.reason?.trim() || values.confirm || Boolean(email) === Boolean(userId)) {
			console.error(USAGE)
			return 2
		}
		try {
			const result = await resetTwoFactorAsOperator(
				email ? { email } : { userId: userId as string },
				{ reason: values.reason },
			)
			console.log(
				result.changed
					? `${result.userId}: two-factor authentication removed; ${result.sessionsEnded} session(s) ended`
					: `${result.userId}: two-factor authentication was not on; no change needed`,
			)
			return 0
		} catch (error) {
			if (error instanceof AppError) {
				console.error(error.message)
				return 1
			}
			console.error(`reset failed: ${error instanceof Error ? error.name : typeof error}`)
			return 1
		}
	}
	if (
		(command !== "grant" && command !== "revoke") ||
		values.confirm ||
		!values.reason?.trim() ||
		Boolean(email) === Boolean(userId)
	) {
		console.error(USAGE)
		return 2
	}
	try {
		const result = await changeRole(
			email ? { email } : { userId: userId as string },
			command === "grant" ? "admin" : "user",
			values.reason,
		)
		console.log(
			result.changed
				? `${result.userId}: role is now ${result.role}; ${result.sessionsRevoked} session(s) ended, sign in again`
				: `${result.userId}: role is already ${result.role}; no change needed`,
		)
		return 0
	} catch (error) {
		if (error instanceof AppError) {
			console.error(error.message)
			return 1
		}
		// The message could hold query parameters (an email): print its kind only.
		console.error(`role change failed: ${error instanceof Error ? error.name : typeof error}`)
		return 1
	}
}

let code = 1
try {
	code = await main()
} finally {
	await pool.end()
}
process.exit(code)
