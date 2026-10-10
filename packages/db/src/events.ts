import { errorLabel } from "@klipstack/log"
import pg from "pg"
import { pool } from "./client"
import { databaseUrl } from "./env"

/**
 * Change notifications over Postgres LISTEN/NOTIFY: the worker and the web app publish, the web
 * app forwards them to browsers as server-sent events. One channel, JSON payloads.
 */
export const DOCUMENT_EVENTS_CHANNEL = "klipstack_documents"

export type DocumentEvent =
	| {
			userId: string
			documentId: string
			/** What happened: a status the document reached, or `images` when its images finished. */
			kind: "queued" | "processing" | "ready" | "failed" | "images"
	  }
	| {
			userId: string
			/** New items arrived in one of the user's feeds. */
			kind: "feed"
	  }

export async function notifyDocumentEvent(event: DocumentEvent): Promise<void> {
	try {
		await pool.query("select pg_notify($1, $2)", [DOCUMENT_EVENTS_CHANNEL, JSON.stringify(event)])
	} catch (error) {
		// Notifications are best effort: the UI falls back to a refresh on focus.
		console.warn(`[events] notify failed: ${errorLabel(error)}`)
	}
}

/**
 * Subscribes to document events on a dedicated connection (LISTEN needs one outside the pool).
 * Reconnects with backoff if the connection drops. Returns a function that stops listening.
 */
export function listenDocumentEvents(onEvent: (event: DocumentEvent) => void): () => void {
	let client: pg.Client | null = null
	let stopped = false
	let attempt = 0

	const connect = async () => {
		if (stopped) return
		const next = new pg.Client({ connectionString: databaseUrl() })
		client = next
		next.on("notification", (msg) => {
			if (msg.channel !== DOCUMENT_EVENTS_CHANNEL || !msg.payload) return
			try {
				onEvent(JSON.parse(msg.payload) as DocumentEvent)
			} catch {
				// ignore malformed payloads
			}
		})
		next.on("error", () => {
			void reconnect()
		})
		next.on("end", () => {
			void reconnect()
		})
		try {
			await next.connect()
			await next.query(`listen ${DOCUMENT_EVENTS_CHANNEL}`)
			attempt = 0
		} catch {
			void reconnect()
		}
	}

	const reconnect = async () => {
		if (stopped) return
		const current = client
		client = null
		if (current) {
			current.removeAllListeners()
			void current.end().catch(() => undefined)
		}
		const delay = Math.min(30_000, 500 * 2 ** attempt++)
		await new Promise((r) => setTimeout(r, delay))
		await connect()
	}

	void connect()
	return () => {
		stopped = true
		const current = client
		client = null
		if (current) {
			current.removeAllListeners()
			void current.end().catch(() => undefined)
		}
	}
}
