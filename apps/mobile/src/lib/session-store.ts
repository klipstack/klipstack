import * as SecureStore from "expo-secure-store"

/**
 * The signed-in session, kept as one JSON keychain item. The share extension
 * (targets/share/ShareViewController.swift) reads and refreshes the same item, so the service,
 * key, access group and field names must match there.
 */
export type Session = {
	apiUrl: string
	accessToken: string
	refreshToken: string
	/** Seconds since the epoch. */
	expiresAt: number
}

export const APP_GROUP = "group.com.klipstack.app"

const KEY = "session"
const OPTIONS: SecureStore.SecureStoreOptions = {
	keychainService: "klipstack",
	accessGroup: APP_GROUP,
	keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
}

export async function readSession(): Promise<Session | null> {
	const raw = await SecureStore.getItemAsync(KEY, OPTIONS)
	if (!raw) return null
	try {
		return JSON.parse(raw) as Session
	} catch {
		return null
	}
}

export async function writeSession(session: Session): Promise<void> {
	await SecureStore.setItemAsync(KEY, JSON.stringify(session), OPTIONS)
}

export async function clearSession(): Promise<void> {
	await SecureStore.deleteItemAsync(KEY, OPTIONS)
}
