import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { Alert, Pressable } from "react-native"
import { useAuth } from "@/lib/auth"
import { useColors } from "@/lib/theme"
import { speech } from "../../modules/klip-speech"

/** The header's account button: which server the app uses, the voices, and signing out. */
export function AccountButton() {
	const { apiUrl, signOut } = useAuth()
	const colors = useColors()
	const host = apiUrl.replace(/^https?:\/\//, "")
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Account"
			hitSlop={8}
			onPress={() =>
				Alert.alert(`Signed in to ${host}`, undefined, [
					{ text: "Cancel", style: "cancel" },
					...(speech ? [{ text: "Voices", onPress: () => router.push("/voices") }] : []),
					{ text: "Sign out", style: "destructive" as const, onPress: () => void signOut() },
				])
			}
		>
			<SymbolView name="person.crop.circle" tintColor={colors.accent} size={24} />
		</Pressable>
	)
}
