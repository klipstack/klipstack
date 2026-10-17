import { randomUUID } from "node:crypto"

/**
 * Throwaway accounts are known by both their address and their id: `delete` touches an account
 * only when both match, so no real or demo account can be removed by a typo.
 * `.test` is reserved: no mail goes anywhere.
 */
export const DOMAIN = "throwaway.klipstack.test"
const ID_PREFIX = "dev-account-"

export function newAccount(label?: string): { id: string; email: string } {
	const name = label ?? `dev-${Date.now()}`
	if (!/^[a-z0-9][a-z0-9.-]{0,40}$/.test(name))
		throw new Error("--name takes lowercase letters, digits, dots and dashes")
	return { id: `${ID_PREFIX}${randomUUID()}`, email: `${name}@${DOMAIN}` }
}

export function isThrowaway(account: { id: string; email: string }): boolean {
	return account.id.startsWith(ID_PREFIX) && account.email.endsWith(`@${DOMAIN}`)
}
