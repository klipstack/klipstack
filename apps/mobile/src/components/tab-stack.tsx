import { router, Stack } from "expo-router"
import { SymbolView } from "expo-symbols"
import type { ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { AccountButton } from "@/components/account-button"
import { Paper } from "@/components/paper"
import { headerType, useColors } from "@/lib/theme"

/**
 * The navigation stack inside a tab: native tabs draw no header of their own. A large title that
 * shrinks as the list scrolls, and, on the tab's first screen, the account button on the left and,
 * on Home (`canSave`), the button to save a link on the right, where iOS puts adding. The screens
 * a tab opens from its first (`children`) have the way back on the left; the library's lists put
 * their own buttons on the right (`LibraryList`). Titles are in the logo's serif, and every screen
 * is on the page's paper, grain and all (`Paper`): its lists are clear over it.
 */
export function TabStack({
	title,
	canSave = false,
	children,
}: {
	title: string
	canSave?: boolean
	children?: ReactNode
}) {
	const colors = useColors()
	return (
		<Stack
			screenLayout={({ children }) => <Paper>{children}</Paper>}
			screenOptions={{
				...headerType,
				headerLargeTitle: true,
				headerShadowVisible: false,
				headerLargeTitleShadowVisible: false,
				headerTintColor: colors.fg,
				contentStyle: { backgroundColor: colors.bg },
			}}
		>
			<Stack.Screen
				name="index"
				options={{
					title,
					headerLeft: () => <AccountButton />,
					headerRight: canSave ? () => <SaveLinkButton /> : undefined,
				}}
			/>
			{children}
		</Stack>
	)
}

/** Opens the sheet to save a link typed or pasted (`/save`). */
export function SaveLinkButton() {
	const colors = useColors()
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Save a link"
			hitSlop={8}
			onPress={() => router.push("/save")}
		>
			<SymbolView name="plus" tintColor={colors.accent} size={22} />
		</Pressable>
	)
}

/** A header button that is a word: Select, Select All, Done. */
export function HeaderTextButton({
	label,
	strong = false,
	onPress,
}: {
	label: string
	strong?: boolean
	onPress: () => void
}) {
	const colors = useColors()
	return (
		<Pressable accessibilityRole="button" hitSlop={8} onPress={onPress}>
			{({ pressed }) => (
				<Text
					style={[
						styles.text,
						{ color: colors.accent },
						strong && styles.strong,
						pressed && styles.pressed,
					]}
				>
					{label}
				</Text>
			)}
		</Pressable>
	)
}

/** Buttons side by side on the right of the header. */
export function HeaderButtons({ children }: { children: ReactNode }) {
	return <View style={styles.buttons}>{children}</View>
}

const styles = StyleSheet.create({
	buttons: { flexDirection: "row", alignItems: "center", gap: 20 },
	text: { fontSize: 17, paddingHorizontal: 4 },
	strong: { fontWeight: "600" },
	pressed: { opacity: 0.5 },
})
