import { AsyncLocalStorage } from "node:async_hooks"

const gate = new AsyncLocalStorage<true>()

/**
 * Runs `fn` with permission to create a user. In invite mode, better-auth refuses to create users
 * anywhere else (its own sign-up endpoint, social sign-in), so the invite check in /signup cannot
 * be skipped by calling those directly.
 */
export function withSignupAllowed<T>(fn: () => Promise<T>): Promise<T> {
	return gate.run(true, fn)
}

export function signupAllowed(): boolean {
	return gate.getStore() === true
}

export interface LinkSignup {
	/** Already checked by /signup. It travels in the emailed link and is consumed on confirmation. */
	inviteCode: string | null
	locale: string
}

const linkSignup = new AsyncLocalStorage<LinkSignup>()

/**
 * Runs `fn` as a sign-up by emailed link. Only then does the magic-link mailer write to an address
 * with no account. Set by /signup on the server: a client calling better-auth directly cannot.
 */
export function withLinkSignup<T>(signup: LinkSignup, fn: () => Promise<T>): Promise<T> {
	return linkSignup.run(signup, fn)
}

export function pendingLinkSignup(): LinkSignup | undefined {
	return linkSignup.getStore()
}

export interface ProviderSignup {
	/** Already checked by /signup. It travels in the OAuth state and is consumed at the callback. */
	inviteCode: string | null
	/** A sign-in from the app's sheet, which creates no account whatever the sign-up mode. */
	app?: true
}

const providerSignup = new AsyncLocalStorage<ProviderSignup>()

/**
 * Runs `fn` as a sign-up with an external provider. Only then does the sign-in carry an invite in
 * the state's server context, which a client calling better-auth directly cannot write.
 */
export function withProviderSignup<T>(signup: ProviderSignup, fn: () => Promise<T>): Promise<T> {
	return providerSignup.run(signup, fn)
}

export function pendingProviderSignup(): ProviderSignup | undefined {
	return providerSignup.getStore()
}

/** What the provider callback's user creation leaves for the code that wraps it. */
export interface ProviderCallback {
	/** The invite the new user was let in with: locked, not yet consumed. */
	inviteCode?: string
	email?: string
}

const providerCallback = new AsyncLocalStorage<ProviderCallback>()

export function withProviderCallback<T>(scope: ProviderCallback, fn: () => Promise<T>): Promise<T> {
	return providerCallback.run(scope, fn)
}

export function currentProviderCallback(): ProviderCallback | undefined {
	return providerCallback.getStore()
}
