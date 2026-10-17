import { z } from "zod"
import { ACCOUNT_DELETION_CLIENTS } from "../auth"
import { defineEndpoint, empty, json } from "../endpoint"
import { Me, Time } from "../schemas"

export const getMe = defineEndpoint({
	id: "me.get",
	method: "GET",
	path: "/me",
	scope: "read",
	summary: "The account behind the token, and what the token may do.",
	response: json(Me),
	errors: [],
})

/** How much of a cap the account has used. */
const Against = z.object({
	used: z.number().int().nonnegative(),
	max: z.number().int().nonnegative(),
})

/** Where the account stands against each of its caps, as Settings' Usage shows it. */
export const Usage = z
	.object({
		/** New articles this month. */
		saves: Against,
		/** Bytes stored: captured pages, extracted versions (the trash's too) and images. */
		storage: Against,
		/** Feeds followed now. */
		feeds: Against,
		/** Editions published for the first time this month. */
		editions: Against,
		/** Questions asked of the AI this month; null when the account has no AI, or turned it off. */
		ai: Against.nullable(),
		/** Articles sorted into topics this month; null while the reader has no topics. */
		topicSorts: Against.nullable(),
		/** When the monthly counts start over: the 1st of next month, UTC. */
		resetsAt: Time,
	})
	.meta({ id: "Usage" })
export type Usage = z.infer<typeof Usage>

export const getUsage = defineEndpoint({
	id: "usage.get",
	method: "GET",
	path: "/usage",
	scope: "read",
	summary: "Where the account stands against each of its caps this month.",
	response: json(Usage),
	errors: [],
})

/** The longest email an account can have, with room: the confirmation is compared, not stored. */
const CONFIRM_EMAIL_MAX = 320

export const deleteAccount = defineEndpoint({
	id: "account.delete",
	method: "POST",
	path: "/account/delete",
	scope: "write",
	clients: {
		ids: ACCOUNT_DELETION_CLIENTS,
		refusal:
			"Only Klipstack's own apps can delete the account. Delete it in Settings on the web instead.",
		audience: "Klipstack's own apps",
		note: "Delete an account in Settings on the web otherwise.",
	},
	summary:
		"Deletes the account and everything in it, for good. Needs `confirmEmail`, the account's email, and a sign-in from the last 30 minutes behind the token (`reauthentication_required` otherwise: sign in again, then repeat).",
	body: z.object({ confirmEmail: z.string().max(CONFIRM_EMAIL_MAX) }),
	response: empty(),
	errors: ["reauthentication_required"],
})
