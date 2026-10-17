import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { Children, isValidElement, type ReactNode } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { fonts, useColors } from "@/lib/theme"

/**
 * A group of rows on a card, as iOS's grouped lists: a heading in the logo's serif, in sentence
 * case, over the card, and a footnote under it. Rows are divided by a hairline.
 */
export function Section({
	title,
	footnote,
	children,
}: {
	title?: string
	footnote?: ReactNode
	children: ReactNode
}) {
	const colors = useColors()
	const rows = Children.toArray(children).filter(Boolean)
	return (
		<View style={styles.section}>
			{title ? (
				<Text accessibilityRole="header" style={[styles.heading, { color: colors.mutedFg }]}>
					{title}
				</Text>
			) : null}
			<View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
				{rows.map((row, i) => (
					<View
						key={isValidElement(row) ? row.key : i}
						style={
							i > 0 && {
								borderTopColor: colors.border,
								borderTopWidth: StyleSheet.hairlineWidth,
							}
						}
					>
						{row}
					</View>
				))}
			</View>
			{footnote ? (
				<Text style={[styles.footnote, { color: colors.mutedFg }]}>{footnote}</Text>
			) : null}
		</View>
	)
}

/**
 * A row that does something: a label, what it holds now (`value`), and a chevron when it opens a
 * screen (`push`) or an arrow when it leaves for the web (`web`). `danger` for what can't be undone.
 */
export function Row({
	label,
	value,
	icon,
	push = false,
	web = false,
	danger = false,
	busy = false,
	disabled = false,
	onPress,
}: {
	label: string
	value?: string
	icon?: SymbolViewProps["name"]
	push?: boolean
	web?: boolean
	danger?: boolean
	busy?: boolean
	disabled?: boolean
	onPress: () => void
}) {
	const colors = useColors()
	const color = danger ? colors.danger : colors.fg
	return (
		<Pressable
			accessibilityRole={web ? "link" : "button"}
			accessibilityLabel={label}
			accessibilityValue={value ? { text: value } : undefined}
			accessibilityState={{ disabled: disabled || busy, busy }}
			disabled={disabled || busy}
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}
		>
			{icon ? (
				<SymbolView name={icon} tintColor={danger ? colors.danger : colors.accent} size={20} />
			) : null}
			<Text
				style={[styles.label, !value && styles.grow, { color }, disabled && styles.dim]}
				numberOfLines={1}
			>
				{label}
			</Text>
			{value ? (
				<Text style={[styles.value, { color: colors.mutedFg }]} numberOfLines={1}>
					{value}
				</Text>
			) : null}
			{busy ? (
				<ActivityIndicator color={colors.mutedFg} />
			) : push || web ? (
				<SymbolView
					name={web ? "arrow.up.right" : "chevron.right"}
					tintColor={colors.mutedFg}
					size={13}
					weight="semibold"
				/>
			) : null}
		</Pressable>
	)
}

/** Choices side by side, one of them picked: light or dark, serif or sans-serif. */
export function Choices<T extends string>({
	label,
	options,
	value,
	onChange,
}: {
	label: string
	options: ReadonlyArray<{ id: T; label: string }>
	value: T
	onChange: (next: T) => void
}) {
	const colors = useColors()
	return (
		<View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
			<Text style={[styles.label, { color: colors.fg }]}>{label}</Text>
			<View style={[styles.choices, { backgroundColor: colors.muted }]}>
				{options.map((option) => {
					const on = option.id === value
					return (
						<Pressable
							key={option.id}
							accessibilityRole="radio"
							accessibilityLabel={option.label}
							accessibilityState={{ selected: on }}
							onPress={() => onChange(option.id)}
							style={[styles.choice, on && { backgroundColor: colors.card }]}
						>
							<Text style={[styles.choiceText, { color: on ? colors.fg : colors.mutedFg }]}>
								{option.label}
							</Text>
						</Pressable>
					)
				})}
			</View>
		</View>
	)
}

export const listStyles = StyleSheet.create({
	content: { padding: 16, paddingBottom: 48, gap: 24 },
})

const styles = StyleSheet.create({
	section: { gap: 8 },
	heading: { fontFamily: fonts.display, fontSize: 17, marginHorizontal: 4 },
	card: {
		borderRadius: 14,
		borderWidth: StyleSheet.hairlineWidth,
		overflow: "hidden",
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingVertical: 12,
		paddingHorizontal: 16,
		minHeight: 48,
	},
	label: { fontSize: 17, flexShrink: 1 },
	grow: { flex: 1 },
	value: { fontSize: 17, flex: 1, textAlign: "right" },
	dim: { opacity: 0.4 },
	footnote: { fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
	choices: {
		flexDirection: "row",
		marginLeft: "auto",
		borderRadius: 9,
		padding: 2,
	},
	choice: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 7 },
	choiceText: { fontSize: 15 },
})
