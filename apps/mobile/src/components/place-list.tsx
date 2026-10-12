import { type Href, Link } from "expo-router"
import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { Children, Fragment, type ReactElement, type ReactNode, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import type { Colors } from "@/lib/theme"

/**
 * Rows in a rounded group, as iOS's grouped lists (Settings, Mail's mailboxes) draw them, with an
 * optional heading above: the Library's places, the tags, and the search's topics.
 */
export function PlaceGroup({
	title,
	colors,
	children,
}: {
	title?: string
	colors: Colors
	children: ReactNode
}) {
	const rows = Children.toArray(children)
	if (rows.length === 0) return null
	return (
		<View>
			{title ? (
				<Text accessibilityRole="header" style={[styles.heading, { color: colors.mutedFg }]}>
					{title}
				</Text>
			) : null}
			<View style={[styles.group, { backgroundColor: colors.muted, borderColor: colors.border }]}>
				{/* `Children.toArray` keys each row. */}
				{rows.map((row, i) => (
					<Fragment key={(row as ReactElement).key}>
						{i > 0 ? <View style={[styles.separator, { backgroundColor: colors.border }]} /> : null}
						{row}
					</Fragment>
				))}
			</View>
		</View>
	)
}

/**
 * A row that opens a list (`href`): its icon, its name, a detail on the right (a count), and a
 * chevron. With a `menu` (`Link.MenuAction`s, in a list: the menu reads no fragment), a long press
 * opens it, the row lifted.
 */
export function PlaceRow({
	title,
	icon,
	detail,
	href,
	menu,
	colors,
}: {
	title: string
	icon: SymbolViewProps["name"]
	detail?: string
	href: Href
	menu?: ReactNode[]
	colors: Colors
}) {
	const [pressed, setPressed] = useState(false)
	return (
		<Link href={href} push asChild>
			<Link.Trigger>
				<Pressable
					accessibilityRole="button"
					onPressIn={() => setPressed(true)}
					onPressOut={() => setPressed(false)}
					// The Link takes one style object, not a list.
					style={StyleSheet.flatten([
						styles.row,
						{ backgroundColor: pressed ? colors.border : colors.muted },
					])}
				>
					<SymbolView name={icon} tintColor={colors.accent} size={22} style={styles.icon} />
					<Text style={[styles.title, { color: colors.fg }]} numberOfLines={1}>
						{title}
					</Text>
					{detail ? <Text style={[styles.detail, { color: colors.mutedFg }]}>{detail}</Text> : null}
					<SymbolView name="chevron.right" tintColor={colors.mutedFg} size={14} weight="semibold" />
				</Pressable>
			</Link.Trigger>
			{menu ? <Link.Menu>{menu}</Link.Menu> : null}
		</Link>
	)
}

/**
 * A row that acts in place (`onPress`) instead of opening a list: no chevron. VoiceOver reads
 * `label` (the title and what the detail means), not the icon's name.
 */
export function PlaceButton({
	title,
	icon,
	detail,
	label,
	onPress,
	colors,
}: {
	title: string
	icon: SymbolViewProps["name"]
	detail?: string
	label?: string
	onPress: () => void
	colors: Colors
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label ?? title}
			onPress={onPress}
			style={({ pressed }) => [
				styles.row,
				{ backgroundColor: pressed ? colors.border : colors.muted },
			]}
		>
			<SymbolView name={icon} tintColor={colors.accent} size={22} style={styles.icon} />
			<Text style={[styles.title, { color: colors.fg }]} numberOfLines={1}>
				{title}
			</Text>
			{detail ? <Text style={[styles.detail, { color: colors.mutedFg }]}>{detail}</Text> : null}
		</Pressable>
	)
}

const ICON = 28
const PAD = 16

const styles = StyleSheet.create({
	heading: {
		fontSize: 13,
		textTransform: "uppercase",
		letterSpacing: 0.4,
		paddingHorizontal: PAD,
		paddingBottom: 6,
	},
	group: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		minHeight: 48,
		paddingHorizontal: PAD,
	},
	icon: { width: ICON, height: ICON },
	title: { flex: 1, fontSize: 17 },
	detail: { fontSize: 17, fontVariant: ["tabular-nums"] },
	// From the title, as iOS's grouped lists draw it.
	separator: { height: StyleSheet.hairlineWidth, marginLeft: PAD + ICON + 12 },
})
