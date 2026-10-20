import { APP_SIGN_IN_CODE_LENGTH, type AppSignInOptions } from "@klipstack/api-contract/auth"
import * as AppleAuthentication from "expo-apple-authentication"
import { type ReactNode, useEffect, useRef, useState } from "react"
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	useColorScheme,
	View,
} from "react-native"
import Svg, { Path } from "react-native-svg"
import {
	sendSignInCode,
	signInOptions,
	signInWith,
	signInWithApple,
	signInWithProvider,
} from "@/lib/oauth"
import type { Session } from "@/lib/session-store"
import { useColors } from "@/lib/theme"

type Busy = "apple" | "google" | "github" | "email" | "code" | null

/** Until the server says, the email and password only. */
const NO_OPTIONS: AppSignInOptions = { providers: [], emailCode: false }

/**
 * The app's ways in, on its own screen: Sign in with Apple in iOS's sheet, Google and GitHub in a
 * private sign-in sheet, and the email with a password or an emailed code. Each ends in a session
 * for `onSession`. Only what the server offers shows (`GET /app/sign-in`).
 */
export function SignInForm({
	apiUrl,
	header,
	onSession,
}: {
	apiUrl: string
	header?: ReactNode
	onSession: (session: Session) => Promise<void>
}) {
	const colors = useColors()
	const dark = useColorScheme() === "dark"
	const [options, setOptions] = useState<AppSignInOptions>(NO_OPTIONS)
	const [appleAvailable, setAppleAvailable] = useState(false)
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [code, setCode] = useState("")
	// After "Email me a code": the code goes where the password went.
	const [codeSentTo, setCodeSentTo] = useState<string | null>(null)
	const [busy, setBusy] = useState<Busy>(null)
	const [error, setError] = useState<string | null>(null)
	const passwordField = useRef<TextInput>(null)

	useEffect(() => {
		signInOptions(apiUrl).then(setOptions, () => setOptions(NO_OPTIONS))
		AppleAuthentication.isAvailableAsync().then(setAppleAvailable, () => setAppleAvailable(false))
	}, [apiUrl])

	async function run(kind: Exclude<Busy, null>, signIn: () => Promise<Session | null>) {
		setBusy(kind)
		setError(null)
		try {
			const session = await signIn()
			if (session) await onSession(session)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(null)
		}
	}

	const trimmed = email.trim()
	const withCode = codeSentTo !== null
	const ready = trimmed.includes("@") && (withCode ? code.length > 0 : password.length > 0)

	function submit() {
		if (!ready || busy) return
		if (withCode)
			return run("email", () => signInWith(apiUrl, { method: "code", email: trimmed, code }))
		void run("email", () => signInWith(apiUrl, { method: "password", email: trimmed, password }))
	}

	async function emailCode() {
		if (!trimmed.includes("@")) return setError("Enter your email first.")
		setBusy("code")
		setError(null)
		try {
			await sendSignInCode(apiUrl, trimmed)
			setCodeSentTo(trimmed)
			setCode("")
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(null)
		}
	}

	const showApple = appleAvailable && options.providers.includes("apple")
	const others = options.providers.filter(
		(provider): provider is "google" | "github" => provider !== "apple",
	)
	const input = [
		styles.input,
		{ color: colors.fg, backgroundColor: colors.card, borderColor: colors.border },
	]

	return (
		<KeyboardAvoidingView behavior="padding" style={styles.fill}>
			<ScrollView
				contentContainerStyle={styles.content}
				keyboardShouldPersistTaps="handled"
				contentInsetAdjustmentBehavior="automatic"
			>
				{header}
				{showApple ? (
					<AppleAuthentication.AppleAuthenticationButton
						buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
						buttonStyle={
							dark
								? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
								: AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
						}
						cornerRadius={10}
						style={[styles.appleButton, busy !== null && styles.dimmed]}
						onPress={() => {
							if (!busy) void run("apple", () => signInWithApple(apiUrl))
						}}
					/>
				) : null}
				{others.map((provider) => (
					<Pressable
						key={provider}
						accessibilityRole="button"
						disabled={busy !== null}
						onPress={() => run(provider, () => signInWithProvider(apiUrl, provider))}
						style={({ pressed }) => [
							styles.providerButton,
							{ borderColor: colors.border, backgroundColor: colors.card },
							(pressed || (busy !== null && busy !== provider)) && styles.dimmed,
						]}
					>
						{busy === provider ? (
							<ActivityIndicator color={colors.fg} />
						) : (
							<>
								<Svg width={18} height={18} viewBox="0 0 24 24" fill={colors.fg}>
									<Path d={MARKS[provider]} />
								</Svg>
								<Text style={[styles.providerText, { color: colors.fg }]}>
									Continue with {provider === "google" ? "Google" : "GitHub"}
								</Text>
							</>
						)}
					</Pressable>
				))}
				{showApple || others.length > 0 ? (
					<View style={styles.or}>
						<View style={[styles.rule, { backgroundColor: colors.border }]} />
						<Text style={[styles.orText, { color: colors.mutedFg }]}>or</Text>
						<View style={[styles.rule, { backgroundColor: colors.border }]} />
					</View>
				) : null}

				<TextInput
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
				{withCode ? (
					<>
						<Text style={[styles.note, { color: colors.mutedFg }]}>
							If {codeSentTo} has an account, a code is on its way. It expires in 10 minutes.
						</Text>
						<TextInput
							// Its own key: a field reused from the other mode keeps iOS's letter spacing.
							key="code"
							ref={passwordField}
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
							style={[input, styles.code]}
						/>
					</>
				) : (
					<TextInput
						key="password"
						ref={passwordField}
						accessibilityLabel="Password"
						value={password}
						onChangeText={setPassword}
						placeholder="Password"
						placeholderTextColor={colors.mutedFg}
						secureTextEntry
						autoCapitalize="none"
						autoCorrect={false}
						autoComplete="current-password"
						textContentType="password"
						returnKeyType="go"
						editable={busy === null}
						onSubmitEditing={submit}
						style={input}
					/>
				)}
				<Pressable
					accessibilityRole="button"
					disabled={!ready || busy !== null}
					onPress={submit}
					style={[
						styles.button,
						{ backgroundColor: colors.accent },
						(!ready || (busy !== null && busy !== "email")) && styles.dimmed,
					]}
				>
					{busy === "email" ? (
						<ActivityIndicator color={colors.accentFg} />
					) : (
						<Text style={[styles.buttonText, { color: colors.accentFg }]}>Sign in</Text>
					)}
				</Pressable>
				{options.emailCode ? (
					<View style={styles.links}>
						<Pressable
							accessibilityRole="button"
							disabled={busy !== null}
							onPress={emailCode}
							hitSlop={8}
						>
							<Text style={[styles.link, { color: colors.accent }]}>
								{busy === "code"
									? "Sending…"
									: withCode
										? "Send a new code"
										: "Email me a code instead"}
							</Text>
						</Pressable>
						{withCode ? (
							<Pressable
								accessibilityRole="button"
								disabled={busy !== null}
								onPress={() => setCodeSentTo(null)}
								hitSlop={8}
							>
								<Text style={[styles.link, { color: colors.accent }]}>Use a password</Text>
							</Pressable>
						) : null}
					</View>
				) : null}
				{error ? (
					<Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.danger }]}>
						{error}
					</Text>
				) : null}
			</ScrollView>
		</KeyboardAvoidingView>
	)
}

// The web's marks (apps/web/app/components/provider-buttons.tsx), one color like its buttons.
const MARKS = {
	google:
		"M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.18-1.73 4.1-1.02 1.08-2.62 2.24-5.43 2.24-4.34 0-7.78-3.5-7.78-7.84s3.44-7.84 7.78-7.84c2.35 0 4.06.92 5.32 2.12l2.3-2.3C18.7 2.66 16.06 1.4 12.48 1.4 6.62 1.4 1.7 6.18 1.7 12.04s4.92 10.64 10.78 10.64c3.16 0 5.54-1.04 7.4-2.98 1.92-1.92 2.52-4.6 2.52-6.78 0-.68-.06-1.3-.16-1.82l-9.76-.18Z",
	github:
		"M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.78c-2.92.64-3.54-1.4-3.54-1.4-.48-1.22-1.17-1.54-1.17-1.54-.95-.65.08-.64.08-.64 1.05.08 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.67-1.4-2.33-.27-4.78-1.17-4.78-5.19 0-1.15.41-2.08 1.08-2.82-.1-.26-.47-1.33.1-2.78 0 0 .89-.28 2.89 1.08a10 10 0 0 1 5.26 0c2-1.36 2.88-1.08 2.88-1.08.58 1.45.22 2.52.11 2.78.67.74 1.08 1.67 1.08 2.82 0 4.03-2.46 4.92-4.8 5.18.38.33.72.97.72 1.95v2.89c0 .28.19.6.72.5A10.5 10.5 0 0 0 12 1.5Z",
} as const

const styles = StyleSheet.create({
	fill: { flex: 1 },
	content: {
		flexGrow: 1,
		justifyContent: "center",
		paddingHorizontal: 32,
		paddingVertical: 24,
		gap: 12,
	},
	appleButton: { height: 50 },
	providerButton: {
		height: 50,
		borderRadius: 10,
		borderWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
	},
	providerText: { fontSize: 17, fontWeight: "600" },
	or: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
	rule: { flex: 1, height: StyleSheet.hairlineWidth },
	orText: { fontSize: 13 },
	input: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 10,
		paddingHorizontal: 14,
		paddingVertical: 13,
		fontSize: 17,
	},
	code: { letterSpacing: 6, fontVariant: ["tabular-nums"] },
	note: { fontSize: 15, lineHeight: 21 },
	button: { borderRadius: 10, height: 50, alignItems: "center", justifyContent: "center" },
	buttonText: { fontSize: 17, fontWeight: "600" },
	links: { flexDirection: "row", justifyContent: "center", gap: 24, paddingVertical: 4 },
	link: { fontSize: 15, fontWeight: "500" },
	error: { fontSize: 15, lineHeight: 21 },
	dimmed: { opacity: 0.5 },
})
