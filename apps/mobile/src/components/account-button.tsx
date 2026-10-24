import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { Pressable } from "react-native"
import { t } from "@/lib/i18n"
import { useColors } from "@/lib/theme"

/** The header's account button: opens Account, a sheet over the tabs. */
export function AccountButton() {
	const colors = useColors()
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={t("library.header.account")}
			hitSlop={8}
			onPress={() => router.push("/account")}
		>
			<SymbolView name="person.crop.circle" tintColor={colors.accent} size={24} />
		</Pressable>
	)
}
