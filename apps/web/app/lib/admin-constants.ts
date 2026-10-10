/** Shared by admin pages (browser) and admin services (server). */
export const INVITE_STATUSES = ["active", "used", "expired", "revoked"] as const
export type InviteStatus = (typeof INVITE_STATUSES)[number]

export const INVITE_EXPIRIES = ["1d", "7d", "30d", "never"] as const
export type InviteExpiry = (typeof INVITE_EXPIRIES)[number]
export const INVITE_NOTE_MAX = 200

export const USER_SEARCH_MAX = 200

/** What `/admin/usage` ranks accounts by. */
export const USAGE_ORDERS = ["refused", "storage", "saves", "feeds"] as const
export type UsageOrder = (typeof USAGE_ORDERS)[number]

export function isUsageOrder(value: unknown): value is UsageOrder {
	return typeof value === "string" && (USAGE_ORDERS as readonly string[]).includes(value)
}

/** Accounts `/admin/usage` lists: the top of the ranking, not every account. */
export const USAGE_TOP = 50
