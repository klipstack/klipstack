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
import { errorMessage, t } from "@/lib/i18n"
import {
	type SignUp as Invite,
	sendSignUpCode,
	signInWithApple,
	signInWithProvider,
	signUpWith,
	TwoFactorRequired,
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
		if (needsInvite && !inviteCode.trim()) return setError(t("account.signUp.enterInvite"))
		setBusy(kind)
		setError(null)
		try {
			const session = await step()
			if (session) await signIn(session)
		} catch (e) {
			// Apple's ID belongs to an account with two-factor on: its code step is the sign-in's.
			setError(e instanceof TwoFactorRequired ? t("account.signUp.twoFactor") : errorMessage(e))
		} finally {
			setBusy(null)
		}
	}

	const details = name.trim().length > 0 && trimmedEmail.includes("@") && password.length > 0
	const ready = details && (codeSentTo === null || code.length === APP_SIGN_IN_CODE_LENGTH)

	function sendCode() {
		if (!details || busy) return
		if (password.length < MIN_PASSWORD_LENGTH)
			return setError(t("account.signUp.passwordShort", { min: MIN_PASSWORD_LENGTH }))
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
							accessibilityLabel={t("account.signUp.inviteCode")}
							value={inviteCode}
							onChangeText={setInviteCode}
							placeholder={t("account.signUp.inviteCode")}
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
									{t("account.signUp.noInvite")}{" "}
									<Text style={[styles.link, { color: colors.accent }]}>
										{t("account.signUp.requestOne")}
									</Text>
								</Text>
							</Pressable>
						) : (
							<Text style={[styles.note, { color: colors.mutedFg }]}>
								{t("account.signUp.inviteNeeded")}
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
							accessibilityLabel={t("account.signUp.name")}
							value={name}
							onChangeText={setName}
							placeholder={t("account.signUp.name")}
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
							accessibilityLabel={t("account.signIn.email")}
							value={email}
							onChangeText={(text) => {
								setEmail(text)
								if (codeSentTo && text.trim() !== codeSentTo) setCodeSentTo(null)
							}}
							placeholder={t("account.signIn.email")}
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
							accessibilityLabel={t("account.signIn.password")}
							value={password}
							onChangeText={setPassword}
							placeholder={t("account.signUp.passwordPlaceholder")}
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
									{t("account.signUp.codeSent", { email: codeSentTo })}
								</Text>
								<TextInput
									accessibilityLabel={t("account.signIn.codeLabel")}
									value={code}
									onChangeText={(text) => setCode(text.replace(/\D/g, ""))}
									placeholder={t("account.signIn.code")}
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
									{codeSentTo === null ? t("account.signUp.emailCode") : t("account.signUp.create")}
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
									<Text style={[styles.link, { color: colors.accent }]}>
										{t("account.signIn.newCode")}
									</Text>
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
					{t("account.signUp.agreeBefore")}{" "}
					<Text
						accessibilityRole="link"
						onPress={() => open("/terms")}
						style={[styles.link, { color: colors.accent }]}
					>
						{t("account.signUp.terms")}
					</Text>{" "}
					{t("account.signUp.and")}{" "}
					<Text
						accessibilityRole="link"
						onPress={() => open("/privacy")}
						style={[styles.link, { color: colors.accent }]}
					>
						{t("account.signUp.privacy")}
					</Text>
					{t("account.signUp.agreeAfter")}
				</Text>
				<Pressable
					accessibilityRole="button"
					disabled={busy !== null}
					onPress={() => router.back()}
					hitSlop={8}
					style={styles.footer}
				>
					<Text style={[styles.note, { color: colors.mutedFg, textAlign: "center" }]}>
						{t("account.signUp.haveAccount")}{" "}
						<Text style={[styles.link, { color: colors.accent }]}>
							{t("account.signUp.signIn")}
						</Text>
					</Text>
				</Pressable>
			</ScrollView>
		</KeyboardAvoidingView>
	)
}
