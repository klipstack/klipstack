import {
	and,
	db,
	type Db,
	documents,
	eq,
	gt,
	highlights,
	notExists,
	notInArray,
	type Onboarding,
	type SQL,
	sql,
	type Tx,
	user as userTable,
} from "@klipstack/db"
import { topicModels } from "~/lib/ai.server"
import { env } from "~/lib/env.server"
import { chromiumDesktop, extensionInStore } from "~/lib/extension-url"
import { hasFeature } from "~/lib/features.server"
import { resolvePrefs } from "~/lib/prefs"
import { starterTexts, starterUrlHash } from "~/lib/starter-texts.server"
import { hasTopics } from "./topics.server"

/**
 * Sets fields of the account's `onboarding` (`UserPrefs`), keeping the others; with `when`, only
 * if it holds. Whether the account was changed.
 */
export async function setOnboarding(
	tx: Db | Tx,
	userId: string,
	fields: Onboarding,
	{ when }: { when?: SQL } = {},
): Promise<boolean> {
	const rows = await tx
		.update(userTable)
		.set({
			prefs: sql`jsonb_set(${userTable.prefs}, '{onboarding}', coalesce(${userTable.prefs}->'onboarding', '{}'::jsonb) || ${JSON.stringify(fields)}::jsonb)`,
		})
		.where(and(eq(userTable.id, userId), when))
		.returning({ id: userTable.id })
	return rows.length > 0
}

/** A field of the account's `onboarding`, as text, for `setOnboarding`'s `when`. */
export const onboardingField = (field: keyof Onboarding) =>
	sql`${userTable.prefs}->'onboarding'->>${field}`

/** Topics, feeds or editions were turned on: Getting started's last step is done, for good. */
export function markFeatureOn(tx: Db | Tx, userId: string) {
	return setOnboarding(
		tx,
		userId,
		{ featureOnAt: new Date().toISOString() },
		{ when: sql`${onboardingField("featureOnAt")} is null` },
	)
}

export interface GettingStarted {
	/** An article saved, the starter texts aside. */
	save: boolean
	/**
	 * An article saved with the browser extension. Null where the step is not offered: a browser the
	 * store's extension is not for, or a server it does not save to. A done step always shows.
	 */
	extension: boolean | null
	/** A passage highlighted, in any article. */
	highlight: boolean
	/** Topics, feeds or editions turned on, once. */
	feature: boolean
	/** Topics are among the features this account can turn on. */
	topics: boolean
}

/**
 * The sidebar's Getting started card: each step and whether it is done. Null once the card is
 * over (closed, or seen with every step done). `extension`: whether to offer the extension step.
 */
export async function gettingStarted(
	userId: string,
	{ extension }: { extension: boolean },
): Promise<GettingStarted | null> {
	const [row] = await db
		.select({ prefs: userTable.prefs })
		.from(userTable)
		.where(eq(userTable.id, userId))
	if (!row) return null
	const prefs = resolvePrefs(row.prefs)
	if (prefs.onboarding.cardEndedAt) return null
	const starters = starterTexts().map(starterUrlHash)
	const [saved, fromExtension, highlighted, topicsOn, topicsFlag] = await Promise.all([
		exists(
			db
				.select({ id: documents.id })
				.from(documents)
				.where(and(eq(documents.userId, userId), notInArray(documents.urlHash, starters)))
				.limit(1),
		),
		exists(
			db
				.select({ id: documents.id })
				.from(documents)
				.where(and(eq(documents.userId, userId), eq(documents.captureSource, "extension")))
				.limit(1),
		),
		exists(
			db
				.select({ id: highlights.id })
				.from(highlights)
				.where(eq(highlights.userId, userId))
				.limit(1),
		),
		hasTopics(userId),
		hasFeature(userId, "topics"),
	])
	return {
		save: saved,
		extension: fromExtension || (extension ? false : null),
		highlight: highlighted,
		feature:
			!!prefs.onboarding.featureOnAt || prefs.editions === "on" || prefs.feeds === "on" || topicsOn,
		topics: topicsOn || (topicModels.available && topicsFlag),
	}
}

async function exists(query: Promise<unknown[]>): Promise<boolean> {
	return (await query).length > 0
}

/** The store's extension saves to klipstack.com only, and installs in Chromium on a computer. */
export function extensionOffered(headers: Headers): boolean {
	return extensionInStore(env.APP_URL) && chromiumDesktop(headers)
}

/** How long after signing up the empty screens mention the browser extension. */
const EXTENSION_HINT_DAYS = 30

/**
 * Whether Home's and the Inbox's empty screens mention the browser extension: where it is
 * `offered` (the store's extension, in a browser it installs in), to an account under
 * `EXTENSION_HINT_DAYS` old that has never saved with it.
 */
export async function extensionHint(
	userId: string,
	{ offered, now = new Date() }: { offered: boolean; now?: Date },
): Promise<boolean> {
	if (!offered) return false
	const since = new Date(now.getTime() - EXTENSION_HINT_DAYS * 24 * 60 * 60 * 1000)
	const [row] = await db
		.select({ id: userTable.id })
		.from(userTable)
		.where(
			and(
				eq(userTable.id, userId),
				gt(userTable.createdAt, since),
				notExists(
					db
						.select({ id: documents.id })
						.from(documents)
						.where(and(eq(documents.userId, userId), eq(documents.captureSource, "extension"))),
				),
			),
		)
	return !!row
}
