import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { z } from "zod"
import { hash, readJson, writeJson } from "./cache"

export const EMAIL = "reader@demo.klipstack.test"
export const PASSWORD = "local-reader-only"
export const stateSchema = z.object({
	format: z.literal(1),
	profile: z.literal("reader"),
	database: z.string(),
	storage: z.string(),
	userId: z.string().startsWith("demo-reader-"),
	email: z.literal(EMAIL),
	seed: z.string().min(1),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	documents: z.record(
		z.string(),
		z.object({
			id: z.string().uuid(),
			captureHash: z.string(),
			complete: z.boolean(),
			source: z.literal("feed").optional(),
		}),
	),
	feeds: z
		.record(
			z.string(),
			z.object({ id: z.string().uuid(), captureHash: z.string(), complete: z.boolean() }),
		)
		.default({}),
})
export type State = z.infer<typeof stateSchema>

/** Run before importing any DB, auth, or storage module. Refuse libpq query overrides too. */
export function assertLocal(env: NodeJS.ProcessEnv): string {
	if (env.NODE_ENV === "production") throw new Error("Demo commands refuse NODE_ENV=production")
	const url = new URL(env.DATABASE_URL ?? "postgres://missing")
	if (
		!["postgres:", "postgresql:"].includes(url.protocol) ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		url.search ||
		url.pathname.length < 2
	)
		throw new Error("Demo commands require a loopback PostgreSQL URL without query options")
	if (env.STORAGE_DRIVER && env.STORAGE_DRIVER !== "fs")
		throw new Error("Demo commands require STORAGE_DRIVER=fs")
	// Contains no credentials. Ownership records are specific to this DB and storage root.
	return `${url.hostname}:${url.port || "5432"}${url.pathname}`
}
export function checkDate(value: string): string {
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
		!Number.isFinite(Date.parse(value)) ||
		new Date(value).toISOString().slice(0, 10) !== value
	)
		throw new Error("--date must be a calendar date (YYYY-MM-DD)")
	return value
}
export const statePath = (root: string, database: string) =>
	join(root, `reader-${hash(database).slice(0, 16)}.json`)
export async function loadState(
	root: string,
	database: string,
	storage: string,
): Promise<State | null> {
	const raw = await readJson(statePath(root, database))
	if (!raw) return null
	const state = stateSchema.parse(raw)
	if (state.database !== database || state.storage !== storage)
		throw new Error("Demo ownership record does not match this database and storage root")
	return state
}
export const saveState = (root: string, state: State) =>
	writeJson(statePath(root, state.database), state)
export function newState(database: string, storage: string, seed: string, date: string): State {
	return {
		format: 1,
		profile: "reader",
		database,
		storage,
		userId: `demo-reader-${randomUUID()}`,
		email: EMAIL,
		seed,
		date: checkDate(date),
		documents: {},
		feeds: {},
	}
}
/** Both identifiers must match; an existing email alone is never proof of ownership. */
export function assertOwned(state: State | null, rows: Array<{ id: string; email: string }>) {
	if (
		rows.length &&
		(!state || rows.length !== 1 || rows[0]!.id !== state.userId || rows[0]!.email !== state.email)
	)
		throw new Error("Existing account is not owned by this demo record; refusing to change it")
}
