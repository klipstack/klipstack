import { router, Stack } from "expo-router"
import { Pressable, StyleSheet, Text } from "react-native"
import { headerType, useColors } from "@/lib/theme"

/**
 * Account, a sheet over the tabs from the header's account button: its own stack, so Voices and
 * deleting the account open inside it. Titles in the logo's serif, in sentence case.
 */
export default function AccountLayout() {
	const colors = useColors()
	return (
		<Stack
			screenOptions={{
				...headerType,
				headerTintColor: colors.fg,
				headerShadowVisible: false,
				headerBackButtonDisplayMode: "minimal",
				contentStyle: { backgroundColor: colors.bg },
			}}
		>
			<Stack.Screen
				name="index"
				options={{
					title: "Account",
					headerRight: () => (
						<Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.back()}>
							{({ pressed }) => (
								<Text style={[styles.done, { color: colors.accent }, pressed && styles.pressed]}>
									Done
								</Text>
							)}
						</Pressable>
					),
				}}
			/>
			<Stack.Screen name="voices" options={{ title: "Voices" }} />
			<Stack.Screen name="delete" options={{ title: "Delete account" }} />
		</Stack>
	)
}

const styles = StyleSheet.create({
	done: { fontSize: 17, fontWeight: "600", paddingHorizontal: 4 },
	pressed: { opacity: 0.5 },
})
