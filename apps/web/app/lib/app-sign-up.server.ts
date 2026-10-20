import { createHmac, randomInt, timingSafeEqual } from "node:crypto"
import { APP_SIGN_IN_CODE_LENGTH } from "@klipstack/api-contract/auth"
import { db, eq, newId, user, verification } from "@klipstack/db"
import { emailT } from "@klipstack/email"
import { fallbackLanguage, isLocale } from "@klipstack/i18n"
import { APIError } from "better-auth/api"
import { z } from "zod"
import { AppError, parseInput } from "./app-error"
import {
	appleFields,
	authorizationCode,
	codeChallenge,
	cookieOf,
	email,
	refusal,
	signInWithApple,
	sixDigits,
} from "./app-sign-in.server"
import { MIN_PASSWORD_LENGTH, SIGN_IN_CODE_MINUTES } from "./auth-constants"
import { withAuthTransaction } from "./auth-db.server"
import { checkAuthLimit } from "./auth-limits.server"
import { auth } from "./auth.server"
import { emailEnabled, renderEmail, sendEmailInBackground } from "./email.server"
import { env, invitesRequired } from "./env.server"
import { consumeInvite, findUsableInvite } from "./invites.server"
import { type AppSignUp, withAppSignUp, withSignupAllowed } from "./signup-gate.server"

/**
 * The iPhone app's sign-up. Like its sign-in (app-sign-in.server.ts) it ends in an authorization
 * code for `klipstack-mobile`. An account is created only here, or from the app's provider sheet
 * started as a sign-up: with an invite unless sign-up is open, and only once the email is proven
 * (an emailed code) or the provider vouches for it (Apple's sheet, Google, GitHub).
 */

const inviteCode = z.string().trim().max(64).optional()

const SignUp = z.discriminatedUnion("method", [
	z.object({
		method: z.literal("email"),
		codeChallenge,
		inviteCode,
		name: z.string().trim().min(1, "Enter your name.").max(100),
		email,
		password: z
			.string()
			.min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
			.max(256),
		code: sixDigits,
	}),
	z.object({ method: z.literal("apple"), inviteCode, ...appleFields() }),
])

/** Creates the account (or signs in the existing one Apple names) and answers the code. */
export async function appSignUp(input: unknown, headers: Headers): Promise<{ code: string }> {
	const request = parseInput(SignUp, input)
	const cookie = await signUp(request, headers, phoneLocale(headers))
	try {
		return { code: await authorizationCode(cookie, request.codeChallenge) }
	} catch (error) {
		await auth.api.signOut({ headers: new Headers({ cookie }) }).catch(() => undefined)
		throw error
	}
}

async function signUp(
	request: z.output<typeof SignUp>,
	headers: Headers,
	locale: string,
): Promise<string> {
	try {
		if (request.method === "apple")
			return await signInWithApple(request, headers, (create) =>
				asSignUp(request.inviteCode, { locale }, create),
			)
		const address = request.email.trim().toLowerCase()
		await checkAuthLimit("/app/sign-up", address, headers)
		// The invite first: a code spent on a sign-up that can't happen would need another.
		if (invitesRequired && !(await findUsableInvite(request.inviteCode ?? "")))
			throw invalidInvite()
		if (!(await takeCode(address, request.code)))
			throw new AppError("unauthorized", "The code is wrong or has expired. Ask for a new one.")
		const result = await asSignUp(request.inviteCode, { locale, verified: true }, () =>
			auth.api.signUpEmail({
				body: { name: request.name, email: address, password: request.password, locale },
				headers,
				returnHeaders: true,
			}),
		)
		return cookieOf(result.headers)
	} catch (error) {
		if (
			error instanceof APIError &&
			String(error.body?.code ?? "").startsWith("USER_ALREADY_EXISTS")
		)
			throw new AppError("invalid_request", "An account uses this email already. Sign in instead.")
		throw refusal(error, request.method)
	}
}

/**
 * Runs better-auth's part of a sign-up with its invite locked, in one transaction: the invite is
 * consumed only when the user is new (Apple may name an account that exists, which just signs in).
 */
function asSignUp<T>(code: string | undefined, scope: AppSignUp, create: () => Promise<T>) {
	return withAuthTransaction(async (tx) => {
		const invite = invitesRequired ? await findUsableInvite(code ?? "", tx) : null
		if (invitesRequired && !invite) throw invalidInvite()
		const result = await withAppSignUp(scope, () => withSignupAllowed(create))
		const created = (result as { response?: { user?: { id?: string } } }).response?.user?.id
		if (invite && scope.created && created) await consumeInvite(invite.code, created, tx)
		return result
	})
}

/** The phone's first language Klipstack has (its `Accept-Language`), for the new account. */
function phoneLocale(headers: Headers): string {
	const tags = (headers.get("accept-language") ?? "").split(",")
	const primary = tags.map((tag) => tag.split(/[;-]/)[0]?.trim().toLowerCase())
	return primary.find(isLocale) ?? fallbackLanguage
}

const invalidInvite = () =>
	new AppError("forbidden", "This invite code can't be used. Check it, or ask for another one.")

/**
 * `POST /app/sign-up/code`: emails a sign-up code to an address with no account, once its invite
 * checks out. An address with an account is told to sign in instead: the same answer either way.
 */
export async function sendAppSignUpCode(input: unknown, headers: Headers): Promise<void> {
	const request = parseInput(z.object({ email, inviteCode }), input)
	const address = request.email.trim().toLowerCase()
	await checkAuthLimit("/app/sign-up/code", address, headers)
	if (!emailEnabled) throw new AppError("unavailable", "This server can't send email.")
	if (invitesRequired && !(await findUsableInvite(request.inviteCode ?? ""))) throw invalidInvite()
	const existing = await db.query.user.findFirst({ where: eq(user.email, address) })
	if (existing) {
		const t = emailT(existing.locale, "auth")
		const subject = t("signUpCode.existingSubject")
		const rendered = renderEmail({
			heading: subject,
			body: t("signUpCode.existingBody"),
			footer: t("signUpCode.emailIgnore"),
		})
		return sendEmailInBackground({ to: address, subject, ...rendered })
	}
	const code = await newCode(address)
	const t = emailT(phoneLocale(headers), "auth")
	const subject = t("signUpCode.emailSubject")
	const rendered = renderEmail({
		heading: subject,
		body: `${t("signUpCode.emailBody", { minutes: SIGN_IN_CODE_MINUTES })}\n\n${code}`,
		footer: t("signUpCode.emailIgnore"),
	})
	sendEmailInBackground({ to: address, subject, ...rendered })
}

/** The codes, as the sign-in's: hashed, for 10 minutes and 3 tries, one per address at a time. */
const ATTEMPTS = 3
const identifier = (address: string) => `app-sign-up-otp-${address}`
const hash = (code: string) =>
	createHmac("sha256", env.BETTER_AUTH_SECRET).update(`app-sign-up:${code}`).digest("hex")

async function newCode(address: string): Promise<string> {
	const code = String(randomInt(10 ** APP_SIGN_IN_CODE_LENGTH)).padStart(
		APP_SIGN_IN_CODE_LENGTH,
		"0",
	)
	await db.transaction(async (tx) => {
		await tx.delete(verification).where(eq(verification.identifier, identifier(address)))
		await tx.insert(verification).values({
			id: newId(),
			identifier: identifier(address),
			value: `${hash(code)}:0`,
			expiresAt: new Date(Date.now() + SIGN_IN_CODE_MINUTES * 60_000),
		})
	})
	return code
}

/** Whether `code` is the address's: a right one is used up; a wrong one counts as a try. */
async function takeCode(address: string, code: string): Promise<boolean> {
	// Taken out first, so two requests can't both use it.
	const [row] = await db
		.delete(verification)
		.where(eq(verification.identifier, identifier(address)))
		.returning()
	if (!row || row.expiresAt < new Date()) return false
	const [stored = "", tries = "0"] = row.value.split(":")
	const used = Number(tries) || 0
	if (used >= ATTEMPTS) return false
	const expected = Buffer.from(hash(code))
	const right = stored.length === expected.length && timingSafeEqual(Buffer.from(stored), expected)
	if (!right && used + 1 < ATTEMPTS)
		await db.insert(verification).values({ ...row, value: `${stored}:${used + 1}` })
	return right
}
