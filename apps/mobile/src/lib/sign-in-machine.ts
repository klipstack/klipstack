import type { PendingSignIn } from "./oauth"

/**
 * Where a sign-in (or a sign-up) is, on the app's own screen. `K` names what can be running: a
 * way in (`"apple"`, `"email"`, …), or sending a code. One thing runs at a time.
 * - `credentials`: the ways in. `codeSentTo`, after "Email me a code": the code goes where the
 *   password went, for that address.
 * - `twoFactor`: a way in checked out, and the sign-in waits for the authenticator's code. The
 *   emailed code, if that was the way, is spent.
 */
export type SignIn<K extends string> =
	| { step: "credentials"; codeSentTo: string | null; busy: K | null; error: string | null }
	| { step: "twoFactor"; pending: PendingSignIn; busy: K | null; error: string | null }

export function signInStart<K extends string>(): SignIn<K> {
	return { step: "credentials", codeSentTo: null, busy: null, error: null }
}

export type SignInEvent<K extends string> =
	/** Something starts running: refused while another runs. */
	| { type: "start"; kind: K }
	/** It ended without a word to say: signed in, or the person closed a provider's sheet. */
	| { type: "finished" }
	/** It failed: said, and the step stays. */
	| { type: "failed"; message: string }
	/** What was typed won't do, said before anything starts. */
	| { type: "invalid"; message: string }
	/** The way in was right; the account wants its authenticator's code. */
	| { type: "twoFactorRequired"; pending: PendingSignIn }
	/** The sign-in waiting for its code is over (too long, too many tries): it starts again. */
	| { type: "ended"; message: string }
	/** "Email me a code" sent one. */
	| { type: "codeSent"; email: string }
	| { type: "emailChanged"; email: string }
	| { type: "usePassword" }
	/** "Back", from the authenticator's code. */
	| { type: "back" }

/**
 * The next state. Pure: the screen runs the requests and feeds their outcomes back. An event that
 * makes no sense in a state (a second tap while something runs, Back while it is checked) changes
 * nothing, and returns the same state.
 */
export function signInTransition<K extends string>(
	state: SignIn<K>,
	event: SignInEvent<K>,
): SignIn<K> {
	switch (event.type) {
		case "start":
			if (state.busy !== null) return state
			return { ...state, busy: event.kind, error: null }
		case "finished":
			return { ...state, busy: null }
		case "failed":
			return { ...state, busy: null, error: event.message }
		case "invalid":
			if (state.busy !== null) return state
			return { ...state, error: event.message }
		case "twoFactorRequired":
			return { step: "twoFactor", pending: event.pending, busy: null, error: null }
		case "ended":
			return { ...signInStart<K>(), error: event.message }
		case "codeSent":
			if (state.step !== "credentials") return state
			return { ...state, busy: null, codeSentTo: event.email }
		case "emailChanged":
			if (state.step !== "credentials" || state.codeSentTo === null) return state
			if (event.email.trim() === state.codeSentTo) return state
			return { ...state, codeSentTo: null }
		case "usePassword":
			if (state.step !== "credentials" || state.busy !== null) return state
			return { ...state, codeSentTo: null }
		case "back":
			if (state.step !== "twoFactor" || state.busy !== null) return state
			return signInStart<K>()
	}
}
