import Slider from "@react-native-community/slider"
import * as Brightness from "expo-brightness"
import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { useEffect, useState } from "react"
import { Modal, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { COLOR_SCHEMES, type ColorSchemePref } from "@/lib/color-scheme"
import { t } from "@/lib/i18n"
import { stepTextSize, TEXT_SIZES, type TypePrefs } from "@/lib/reader-type"
import { type Colors, fonts } from "@/lib/theme"

const SCHEME_ICONS: Record<ColorSchemePref, SymbolViewProps["name"]> = {
	system: "circle.lefthalf.filled",
	light: "sun.max",
	dark: "moon",
}

/**
 * How the reader looks, from the More menu: the text size, a step smaller or larger; the screen's
 * brightness; light or dark mode (for the whole app); and serif or sans-serif. A card at the
 * bottom that leaves the article in view, so each change shows as it's made.
 */
export function AppearanceSheet({
	visible,
	type,
	onChange,
	scheme,
	onScheme,
	onClose,
	colors,
}: {
	visible: boolean
	type: TypePrefs
	onChange: (next: TypePrefs) => void
	scheme: ColorSchemePref
	onScheme: (next: ColorSchemePref) => void
	onClose: () => void
	colors: Colors
}) {
	const insets = useSafeAreaInsets()
	const at = TEXT_SIZES.findIndex((s) => s.id === type.size)
	const size = TEXT_SIZES[at]!
	// The screen's brightness, as Control Center sets it; iOS restores its own when the phone
	// locks. Read each time the card opens: it may have changed since.
	const [brightness, setBrightness] = useState<number | null>(null)
	useEffect(() => {
		if (!visible) return
		let live = true
		Brightness.getBrightnessAsync()
			.then((level) => live && setBrightness(level))
			.catch(() => {})
		return () => {
			live = false
		}
	}, [visible])
	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
			<Pressable
				accessibilityLabel={t("common.actions.close")}
				style={styles.fill}
				onPress={onClose}
			/>
			<View
				style={[
					styles.card,
					{
						backgroundColor: colors.bg,
						borderColor: colors.border,
						paddingBottom: Math.max(insets.bottom, 16),
					},
				]}
			>
				<View style={styles.heading}>
					<Text style={[styles.title, { color: colors.fg }]}>{t("reader.appearance.title")}</Text>
					<Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
						<Text style={[styles.done, { color: colors.accent }]}>{t("common.actions.done")}</Text>
					</Pressable>
				</View>
				<View
					accessible
					accessibilityRole="adjustable"
					accessibilityLabel={t("reader.appearance.textSize")}
					accessibilityValue={{ text: size.label }}
					accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
					onAccessibilityAction={(event) =>
						onChange({
							...type,
							size: stepTextSize(type.size, event.nativeEvent.actionName === "increment" ? 1 : -1),
						})
					}
					style={[styles.sizes, { borderColor: colors.border }]}
				>
					<SizeButton
						label={t("reader.appearance.smaller")}
						glyph={15}
						disabled={at === 0}
						onPress={() => onChange({ ...type, size: stepTextSize(type.size, -1) })}
						colors={colors}
					/>
					<View style={styles.steps}>
						{TEXT_SIZES.map((s, i) => (
							<View
								key={s.id}
								style={[styles.step, { backgroundColor: i <= at ? colors.fg : colors.border }]}
							/>
						))}
					</View>
					<SizeButton
						label={t("reader.appearance.larger")}
						glyph={24}
						disabled={at === TEXT_SIZES.length - 1}
						onPress={() => onChange({ ...type, size: stepTextSize(type.size, 1) })}
						colors={colors}
					/>
				</View>
				<View style={styles.brightness}>
					<SymbolView
						name="sun.min"
						tintColor={colors.mutedFg}
						size={18}
						accessibilityElementsHidden
					/>
					{/* Once the current level is known, so the thumb doesn't jump to it. */}
					{brightness !== null ? (
						<Slider
							accessibilityLabel={t("reader.appearance.brightness")}
							style={styles.grow}
							value={brightness}
							minimumValue={0}
							maximumValue={1}
							minimumTrackTintColor={colors.fg}
							maximumTrackTintColor={colors.border}
							onValueChange={(level) => void Brightness.setBrightnessAsync(level).catch(() => {})}
						/>
					) : (
						<View style={styles.grow} />
					)}
					<SymbolView
						name="sun.max"
						tintColor={colors.mutedFg}
						size={22}
						accessibilityElementsHidden
					/>
				</View>
				<View accessibilityRole="radiogroup" style={styles.choices}>
					{COLOR_SCHEMES.map((s) => (
						<Choice
							key={s.id}
							label={s.label}
							icon={SCHEME_ICONS[s.id]}
							selected={scheme === s.id}
							onPress={() => onScheme(s.id)}
							colors={colors}
						/>
					))}
				</View>
				<View accessibilityRole="radiogroup" style={styles.choices}>
					<Choice
						label={t("reader.appearance.serif")}
						family="Iowan Old Style"
						selected={!type.sans}
						onPress={() => onChange({ ...type, sans: false })}
						colors={colors}
					/>
					<Choice
						label={t("reader.appearance.sans")}
						selected={type.sans}
						onPress={() => onChange({ ...type, sans: true })}
						colors={colors}
					/>
				</View>
			</View>
		</Modal>
	)
}

function SizeButton({
	label,
	glyph,
	disabled,
	onPress,
	colors,
}: {
	label: string
	glyph: number
	disabled: boolean
	onPress: () => void
	colors: Colors
}) {
	return (
		<Pressable
			accessibilityLabel={label}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [styles.size, pressed && { backgroundColor: colors.muted }]}
		>
			<Text style={{ fontSize: glyph, color: disabled ? colors.border : colors.fg }}>A</Text>
		</Pressable>
	)
}

function Choice({
	label,
	icon,
	family,
	selected,
	onPress,
	colors,
}: {
	label: string
	icon?: SymbolViewProps["name"]
	family?: string
	selected: boolean
	onPress: () => void
	colors: Colors
}) {
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityLabel={label}
			accessibilityState={{ selected }}
			onPress={onPress}
			// Chosen, a sheet raised off the others, as the web's reader settings: not a blue tint.
			style={({ pressed }) => [
				styles.choice,
				selected
					? [styles.choiceSelected, { backgroundColor: colors.card, borderColor: colors.border }]
					: { borderColor: colors.border },
				pressed && { opacity: 0.6 },
			]}
		>
			{icon ? (
				<SymbolView name={icon} tintColor={selected ? colors.fg : colors.mutedFg} size={17} />
			) : null}
			<Text
				style={[
					styles.choiceText,
					{ color: selected ? colors.fg : colors.mutedFg, fontFamily: family },
					selected && !family && styles.choiceTextSelected,
				]}
			>
				{label}
			</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	fill: { flex: 1 },
	card: {
		gap: 16,
		paddingTop: 18,
		paddingHorizontal: 16,
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		borderWidth: StyleSheet.hairlineWidth,
		shadowColor: "#000",
		shadowOpacity: 0.18,
		shadowRadius: 16,
		shadowOffset: { width: 0, height: -2 },
	},
	heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
	// A sheet's name, in the logo's serif, as the web's sidebars.
	title: { fontFamily: fonts.display, fontSize: 20 },
	done: { fontSize: 17, fontWeight: "600" },
	sizes: {
		flexDirection: "row",
		alignItems: "center",
		borderRadius: 12,
		borderWidth: StyleSheet.hairlineWidth,
		overflow: "hidden",
	},
	size: { width: 64, height: 48, alignItems: "center", justifyContent: "center" },
	steps: { flex: 1, flexDirection: "row", justifyContent: "center", gap: 6 },
	step: { width: 6, height: 6, borderRadius: 3 },
	brightness: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		height: 40,
		paddingHorizontal: 4,
	},
	grow: { flex: 1 },
	choices: { flexDirection: "row", gap: 10 },
	choice: {
		flex: 1,
		height: 48,
		flexDirection: "row",
		gap: 6,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 12,
		borderWidth: StyleSheet.hairlineWidth,
	},
	choiceSelected: {
		shadowColor: "#000",
		shadowOpacity: 0.08,
		shadowRadius: 2,
		shadowOffset: { width: 0, height: 1 },
	},
	choiceText: { fontSize: 17 },
	choiceTextSelected: { fontWeight: "600" },
})
