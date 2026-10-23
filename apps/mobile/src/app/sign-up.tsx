import { APP_SIGN_IN_CODE_LENGTH } from "@klipstack/api-contract/auth"
import { useRouter } from "expo-router"
import { useRef, useState } from "react"
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native"
import { ProviderButtons, styles, useSignInOptions } from "@/components/sign-in-form"
import { useAuth } from "@/lib/auth"
import {
	type SignUp as Invite,
	sendSignUpCode,
	signInWithApple,
	signInWithProvider,
	signUpWith,
} from "@/lib/oauth"
import type { Session } from "@/lib/session-store"
import { useColors } from "@/lib/theme"
import { openOnTheWeb } from "@/lib/web-pages"

type Busy = "apple" | "google" | "github" | "send" | "create" | null

/**
 * Creating an account in the app (`/app/sign-up`): the invite first, unless the server's sign-up
 * is open, then Apple, Google or GitHub, or a name, email and password confirmed by an emailed
 * code. The new account signs in as after the sign-in screen.
 */
/** The server's minimum (auth-constants.ts), checked here before a code is spent on it. */
const MIN_PASSWORD_LENGTH = 8

export default function SignUpScreen() {
	const { signIn, apiUrl } = useAuth()
	const router = useRouter()
	const colors = useColors()
	const options = useSignInOptions(apiUrl)
	const [inviteCode, setInviteCode] = useState("")
	const [name, setName] = useState("")
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [code, setCode] = useState("")
	const [codeSentTo, setCodeSentTo] = useState<string | null>(null)
	const [busy, setBusy] = useState<Busy>(null)
	const [error, setError] = useState<string | null>(null)
	const emailField = useRef<TextInput>(null)
	const passwordField = useRef<TextInput>(null)

	const needsInvite = options.signUp !== "open"
	const trimmedEmail = email.trim()
	const invite: Invite = needsInvite ? { inviteCode: inviteCode.trim() } : {}

	async function run(kind: Exclude<Busy, null>, step: () => Promise<Session | null | undefined>) {
		if (needsInvite && !inviteCode.trim()) return setError("Enter your invite code first.")
		setBusy(kind)
		setError(null)
		try {
			const session = await step()
			if (session) await signIn(session)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(null)
		}
	}

	const details = name.trim().length > 0 && trimmedEmail.includes("@") && password.length > 0
	const ready = details && (codeSentTo === null || code.length === APP_SIGN_IN_CODE_LENGTH)

	function sendCode() {
		if (!details || busy) return
		if (password.length < MIN_PASSWORD_LENGTH)
			return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`)
		void run("send", async () => {
			await sendSignUpCode(apiUrl, trimmedEmail, invite)
			setCodeSentTo(trimmedEmail)
			setCode("")
			return null
		})
	}

	function submit() {
		if (!ready || busy) return
		if (codeSentTo === null) return sendCode()
		void run("create", () =>
			signUpWith(apiUrl, { ...invite, name: name.trim(), email: trimmedEmail, password, code }),
		)
	}

	const input = [
		styles.input,
		{ color: colors.fg, backgroundColor: colors.card, borderColor: colors.border },
	]
	const open = (path: string) => openOnTheWeb(`${apiUrl}${path}`)

	return (
		<KeyboardAvoidingView behavior="padding" style={[styles.fill, { backgroundColor: colors.bg }]}>
			<ScrollView
				contentContainerStyle={styles.content}
				keyboardShouldPersistTaps="handled"
				contentInsetAdjustmentBehavior="automatic"
			>
				{needsInvite ? (
					<>
						<TextInput
							accessibilityLabel="Invite code"
							value={inviteCode}
							onChangeText={setInviteCode}
							placeholder="Invite code"
							placeholderTextColor={colors.mutedFg}
							autoCapitalize="characters"
							autoCorrect={false}
							editable={busy === null}
							style={input}
						/>
						{options.signUp === "waitlist" ? (
							<Pressable
								accessibilityRole="link"
								onPress={() => open("/request-invite")}
								hitSlop={8}
							>
								<Text style={[styles.note, { color: colors.mutedFg }]}>
									No invite?{" "}
									<Text style={[styles.link, { color: colors.accent }]}>Request one</Text>
								</Text>
							</Pressable>
						) : (
							<Text style={[styles.note, { color: colors.mutedFg }]}>
								Creating an account needs an invite.
							</Text>
						)}
					</>
				) : null}

				<ProviderButtons
					options={options}
					busy={busy}
					signUp
					onApple={() => run("apple", () => signInWithApple(apiUrl, invite))}
					onProvider={(provider) =>
						run(provider, () => signInWithProvider(apiUrl, provider, invite))
					}
				/>

				{options.emailCode ? (
					<>
						<TextInput
							accessibilityLabel="Name"
							value={name}
							onChangeText={setName}
							placeholder="Name"
							placeholderTextColor={colors.mutedFg}
							autoComplete="name"
							textContentType="name"
							returnKeyType="next"
							editable={busy === null}
							onSubmitEditing={() => emailField.current?.focus()}
							style={input}
						/>
						<TextInput
							ref={emailField}
							accessibilityLabel="Email"
							value={email}
							onChangeText={(text) => {
								setEmail(text)
								if (codeSentTo && text.trim() !== codeSentTo) setCodeSentTo(null)
							}}
							placeholder="Email"
							placeholderTextColor={colors.mutedFg}
							autoCapitalize="none"
							autoCorrect={false}
							autoComplete="email"
							keyboardType="email-address"
							textContentType="username"
							returnKeyType="next"
							editable={busy === null}
							onSubmitEditing={() => passwordField.current?.focus()}
							style={input}
						/>
						<TextInput
							ref={passwordField}
							accessibilityLabel="Password"
							value={password}
							onChangeText={setPassword}
							placeholder="Password (8 characters or more)"
							placeholderTextColor={colors.mutedFg}
							secureTextEntry
							autoCapitalize="none"
							autoCorrect={false}
							autoComplete="new-password"
							textContentType="newPassword"
							returnKeyType="go"
							editable={busy === null}
							onSubmitEditing={submit}
							style={input}
						/>
						{codeSentTo !== null ? (
							<>
								<Text style={[styles.note, { color: colors.mutedFg }]}>
									We emailed a code to {codeSentTo}. It expires in 10 minutes.
								</Text>
								<TextInput
									accessibilityLabel="Code from the email"
									value={code}
									onChangeText={(text) => setCode(text.replace(/\D/g, ""))}
									placeholder="Code"
									placeholderTextColor={colors.mutedFg}
									keyboardType="number-pad"
									textContentType="oneTimeCode"
									autoComplete="one-time-code"
									maxLength={APP_SIGN_IN_CODE_LENGTH}
									returnKeyType="go"
									editable={busy === null}
									onSubmitEditing={submit}
									// Spaced digits, not a spaced placeholder.
									style={[input, code ? styles.code : null]}
								/>
							</>
						) : null}
						<Pressable
							accessibilityRole="button"
							disabled={!ready || busy !== null}
							onPress={submit}
							style={[
								styles.button,
								{ backgroundColor: colors.accent },
								(!ready || (busy !== null && busy !== "send" && busy !== "create")) &&
									styles.dimmed,
							]}
						>
							{busy === "send" || busy === "create" ? (
								<ActivityIndicator color={colors.accentFg} />
							) : (
								<Text style={[styles.buttonText, { color: colors.accentFg }]}>
									{codeSentTo === null ? "Email me a code" : "Create account"}
								</Text>
							)}
						</Pressable>
						{codeSentTo !== null ? (
							<View style={styles.links}>
								<Pressable
									accessibilityRole="button"
									disabled={busy !== null}
									onPress={sendCode}
									hitSlop={8}
								>
									<Text style={[styles.link, { color: colors.accent }]}>Send a new code</Text>
								</Pressable>
							</View>
						) : null}
					</>
				) : null}

				{error ? (
					<Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.danger }]}>
						{error}
					</Text>
				) : null}
				<Text style={[styles.note, { color: colors.mutedFg }]}>
					By creating an account you confirm you are 16 or older and agree to the{" "}
					<Text
						accessibilityRole="link"
						onPress={() => open("/terms")}
						style={[styles.link, { color: colors.accent }]}
					>
						Terms
					</Text>{" "}
					and the{" "}
					<Text
						accessibilityRole="link"
						onPress={() => open("/privacy")}
						style={[styles.link, { color: colors.accent }]}
					>
						Privacy Policy
					</Text>
					.
				</Text>
				<Pressable
					accessibilityRole="button"
					disabled={busy !== null}
					onPress={() => router.back()}
					hitSlop={8}
					style={styles.footer}
				>
					<Text style={[styles.note, { color: colors.mutedFg, textAlign: "center" }]}>
						Have an account? <Text style={[styles.link, { color: colors.accent }]}>Sign in</Text>
					</Text>
				</Pressable>
			</ScrollView>
		</KeyboardAvoidingView>
	)
}
