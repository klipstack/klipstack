import { and, db, eq, type FeatureFlag, featureFlags, inArray, userFeatures } from "@klipstack/db"
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
