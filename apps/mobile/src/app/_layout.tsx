import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect, useMemo } from "react"
import { useColorScheme } from "react-native"
import { ToastHost } from "@/components/toast-host"
import { AuthProvider, useAuth } from "@/lib/auth"
import { loadColorScheme } from "@/lib/reader-files"
import { applyColorScheme, useColors } from "@/lib/theme"
import { reloadNextUpInBackground } from "@/lib/widget"

// The launch screen stays up until the app knows whether it is signed in, then fades.
void SplashScreen.preventAutoHideAsync()
// Light or dark as chosen in the reader's Appearance, before the first screen draws.
applyColorScheme(loadColorScheme())
SplashScreen.setOptions({ duration: 250, fade: true })

export default function RootLayout() {
	// The home screen widget catches up with what was read here.
	useEffect(reloadNextUpInBackground, [])
	return (
		<AuthProvider>
			<StatusBar style="auto" />
			<Themed>
				<Screens />
				<ToastHost />
			</Themed>
		</AuthProvider>
	)
}

/** Navigation in the app's colors: without it, screens flash white when tabs switch. */
function Themed({ children }: { children: React.ReactNode }) {
	const dark = useColorScheme() === "dark"
	const colors = useColors()
	const theme = useMemo(() => {
		const base = dark ? DarkTheme : DefaultTheme
		return {
			...base,
			colors: {
				...base.colors,
				primary: colors.accent,
				background: colors.bg,
				card: colors.bg,
				text: colors.fg,
				border: colors.border,
			},
		}
	}, [dark, colors])
	return <ThemeProvider value={theme}>{children}</ThemeProvider>
}

function Screens() {
	const { state } = useAuth()
	const colors = useColors()
	const loading = state.status === "loading"
	useEffect(() => {
		if (!loading) SplashScreen.hide()
	}, [loading])
	if (loading) return null
	return (
		<Stack
			screenOptions={{
				headerTintColor: colors.fg,
				contentStyle: { backgroundColor: colors.bg },
			}}
		>
			<Stack.Protected guard={state.status === "outdated"}>
				<Stack.Screen name="update" options={{ headerShown: false }} />
			</Stack.Protected>
			<Stack.Protected guard={state.status === "signed-in"}>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				{/* Over the tabs, full screen: the back button returns to whichever tab opened it. */}
				<Stack.Screen
					name="read/[id]"
					options={{ title: "", headerBackButtonDisplayMode: "minimal" }}
				/>
				<Stack.Screen name="voices" options={{ title: "Voices", presentation: "modal" }} />
				<Stack.Screen name="save" options={{ title: "Save a Link", presentation: "modal" }} />
			</Stack.Protected>
			<Stack.Protected guard={state.status === "signed-out"}>
				<Stack.Screen name="sign-in" options={{ headerShown: false }} />
			</Stack.Protected>
		</Stack>
	)
}
