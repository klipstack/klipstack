/**
 * How the mobile app names its version to the API, so the server can turn away versions too old
 * to work (`client_outdated`, 426) instead of keeping old behavior forever. Imports nothing.
 */

/** Sent with every request by the mobile app: `<platform>/<major>.<minor>.<patch>`. */
export const CLIENT_HEADER = "X-Klipstack-Client"

export const CLIENT_PLATFORMS = ["ios", "android"] as const
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number]

export type Version = readonly [number, number, number]
export type Client = { platform: ClientPlatform; version: Version }

/** `ios/1.4.0` → `{ platform: "ios", version: [1, 4, 0] }`; anything else → null. */
export function parseClient(header: string | null | undefined): Client | null {
	const match = header?.trim().match(/^([a-z]+)\/(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/)
	if (!match) return null
	const platform = CLIENT_PLATFORMS.find((p) => p === match[1])
	if (!platform) return null
	return { platform, version: [Number(match[2]), Number(match[3]), Number(match[4])] }
}

export function formatClient(platform: ClientPlatform, version: string): string {
	return `${platform}/${version}`
}

/** `1.4.0` → `[1, 4, 0]`; null when it is not three dot-separated numbers. */
export function parseVersion(version: string): Version | null {
	const client = parseClient(`ios/${version}`)
	return client?.version ?? null
}

/** True when `a` comes before `b`. */
export function isOlder(a: Version, b: Version): boolean {
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i]! < b[i]!
	}
	return false
}
