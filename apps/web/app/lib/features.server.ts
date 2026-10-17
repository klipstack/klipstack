import {
	and,
	db,
	eq,
	type FeatureFlag,
	featureFlags,
	inArray,
	user,
	userFeatures,
	type UserPrefs,
} from "@klipstack/db"
import { data } from "react-router"

/** The features in testing turned on for an account, in the order `featureFlags` lists them. */
export async function listFeatures(userId: string): Promise<FeatureFlag[]> {
	const rows = await db
		.select({ feature: userFeatures.feature })
		.from(userFeatures)
		.where(and(eq(userFeatures.userId, userId), inArray(userFeatures.feature, [...featureFlags])))
	const on = new Set(rows.map((row) => row.feature))
	return featureFlags.filter((flag) => on.has(flag))
}

export async function hasFeature(userId: string, feature: FeatureFlag): Promise<boolean> {
	const [row] = await db
		.select({ feature: userFeatures.feature })
		.from(userFeatures)
		.where(and(eq(userFeatures.userId, userId), eq(userFeatures.feature, feature)))
	return !!row
}

/** For a feature's routes: a 404 for accounts without it, as if the page did not exist. */
export async function requireFeature(userId: string, feature: FeatureFlag): Promise<void> {
	if (!(await hasFeature(userId, feature))) throw data(null, { status: 404 })
}

/** The account's own switches in Settings → Features, read from its prefs. */
async function prefsOf(userId: string): Promise<UserPrefs> {
	const [row] = await db.select({ prefs: user.prefs }).from(user).where(eq(user.id, userId))
	return (row?.prefs ?? {}) as UserPrefs
}

/** Editions are on: the account turned them on (they are off by default). */
export async function editionsOn(userId: string): Promise<boolean> {
	return (await prefsOf(userId)).editions === "on"
}

/** For the editor's routes: a 404 while editions are off, as if the page did not exist. */
export async function requireEditions(userId: string): Promise<void> {
	if (!(await editionsOn(userId))) throw data(null, { status: 404 })
}

/** Asking AI while reading: the `ai` feature, and the account has not turned it off. */
export async function aiOn(userId: string): Promise<boolean> {
	const [flag, prefs] = await Promise.all([hasFeature(userId, "ai"), prefsOf(userId)])
	return flag && prefs.ai !== "off"
}
