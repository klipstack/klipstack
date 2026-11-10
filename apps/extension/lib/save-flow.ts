import type { SaveResult } from "./capture"

/**
 * Where a save is, per tab: the one place the background keeps it. The background shows each
 * status as the toolbar badge and, when a tab enters it, as a toast (`entrypoints/background.ts`,
 * `show`). Nothing here touches the browser: `transition` is the whole flow, tested on its own.
 */
export type TabStatus =
	| { phase: "idle" }
	/** Clicked: asking for the server's access, checking the sign-in. */
	| { phase: "starting" }
	/** Sending the page or the link to the server. */
	| { phase: "saving" }
	/** Waiting for the extension's sign-in, in another tab: the save follows it. */
	| { phase: "signingIn" }
	| { phase: "saved"; result: SaveResult }
	| { phase: "failed"; failure: Failure }

/** Why a save did not happen. */
export type Failure =
	/** A page the extension can't capture (the browser's own pages, stores). */
	| { reason: "not_capturable" }
	/** The reader withheld the extension's access to the server. */
	| { reason: "no_access" }
	/** The extension's sign-in was refused or failed. */
	| { reason: "not_connected" }
	/** The server refused the save, or could not be reached. */
	| { reason: "refused"; result: SaveResult }

export type TabEvent =
	/** The reader asked for a save in the tab: the button, the menu, or a sign-in finished. */
	| { type: "clicked" }
	/** The save can't start: `failure` says why. */
	| { type: "refused"; failure: Failure }
	| { type: "sending" }
	| { type: "answered"; result: SaveResult }
	| { type: "signInNeeded" }
	| { type: "signInFailed" }
	/** The reader closed the sign-in unfinished: nothing to say, the next click opens one again. */
	| { type: "signInAbandoned" }
	/** The outcome has been shown long enough. */
	| { type: "faded" }

export const IDLE: TabStatus = { phase: "idle" }

/** Whether a save may start in a tab: one at a time, so a second click sends nothing again. */
export const canStart = (status: TabStatus) =>
	status.phase !== "starting" && status.phase !== "saving"

/** The status after `event`. The same object when the event changes nothing. */
export function transition(status: TabStatus, event: TabEvent): TabStatus {
	switch (event.type) {
		case "clicked":
			if (canStart(status)) return { phase: "starting" }
			// Entered again, so that the reader sees again that it is saving.
			return status.phase === "saving" ? { phase: "saving" } : status
		case "refused":
			return { phase: "failed", failure: event.failure }
		case "sending":
			return { phase: "saving" }
		case "answered":
			return event.result.ok
				? { phase: "saved", result: event.result }
				: { phase: "failed", failure: { reason: "refused", result: event.result } }
		case "signInNeeded":
			return { phase: "signingIn" }
		case "signInFailed":
			return { phase: "failed", failure: { reason: "not_connected" } }
		case "signInAbandoned":
			return status.phase === "signingIn" ? IDLE : status
		case "faded":
			return status.phase === "saved" || status.phase === "failed" ? IDLE : status
	}
}
