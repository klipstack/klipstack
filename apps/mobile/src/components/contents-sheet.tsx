import { useRef } from "react"
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { type Colors, fonts } from "@/lib/theme"
import type { ContentsEntry } from "@/page/messages"

/**
 * The article's contents, as a sheet over the reader, from the More menu: its own headings, in two
 * levels, the section being read marked with a stroke of the progress line's ink. A tap on one
 * goes there (`onSelect`, with its index) and closes the sheet. The web reader's Contents.
 */
export function ContentsSheet({
	visible,
	title,
	entries,
	current,
	onSelect,
	onClose,
	colors,
}: {
	visible: boolean
	/** The article's title. */
	title: string
	entries: ReadonlyArray<ContentsEntry>
	/** The section being read (its index), -1 before the first heading. */
	current: number
	onSelect: (index: number) => void
	onClose: () => void
	colors: Colors
}) {
	const list = useRef<ScrollView>(null)
	const height = useRef(0)
	return (
		<Modal
			visible={visible}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={onClose}
		>
			<View style={[styles.sheet, { backgroundColor: colors.bg }]}>
				<View style={[styles.bar, { borderColor: colors.border }]}>
					<Text style={[styles.barTitle, { color: colors.fg }]}>Contents</Text>
					<Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.done}>
						<Text style={[styles.doneText, { color: colors.accent }]}>Done</Text>
					</Pressable>
				</View>
				<ScrollView
					ref={list}
					contentContainerStyle={styles.content}
					onLayout={(event) => {
						height.current = event.nativeEvent.layout.height
					}}
				>
					<Text style={[styles.title, { color: colors.mutedFg }]} numberOfLines={2}>
						{title}
					</Text>
					{entries.map((entry, i) => {
						const here = i === current
						return (
							<Pressable
								key={entry.key}
								accessibilityRole="button"
								accessibilityState={{ selected: here }}
								accessibilityHint={here ? "The section you're reading" : undefined}
								onPress={() => onSelect(i)}
								// A long outline opens at the section being read, a third of the way down.
								onLayout={
									here
										? (event) => {
												const y = event.nativeEvent.layout.y - height.current / 3
												if (y > 0) list.current?.scrollTo({ y, animated: false })
											}
										: undefined
								}
								style={({ pressed }) => [
									styles.row,
									entry.depth === 1 && styles.under,
									pressed && { backgroundColor: colors.muted },
								]}
							>
								<View
									style={[styles.mark, here && { backgroundColor: colors.inkLine }]}
									accessibilityElementsHidden
								/>
								<Text
									style={[
										entry.depth === 0 ? styles.section : styles.subsection,
										{ color: here || entry.depth === 0 ? colors.fg : colors.mutedFg },
										here && styles.here,
									]}
									numberOfLines={3}
								>
									{entry.text}
								</Text>
							</Pressable>
						)
					})}
				</ScrollView>
			</View>
		</Modal>
	)
}

const styles = StyleSheet.create({
	sheet: { flex: 1 },
	bar: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		height: 56,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	barTitle: { fontFamily: fonts.display, fontSize: 19 },
	done: { position: "absolute", right: 20 },
	doneText: { fontSize: 17, fontWeight: "600" },
	content: { paddingTop: 20, paddingBottom: 48 },
	title: {
		fontFamily: fonts.displayItalic,
		fontSize: 16,
		lineHeight: 21,
		paddingHorizontal: 24,
		marginBottom: 12,
	},
	row: { flexDirection: "row", alignItems: "stretch", paddingRight: 24 },
	under: { paddingLeft: 20 },
	// The section being read: a stroke of the progress line's ink beside it.
	mark: { width: 4, marginLeft: 12, marginRight: 8, marginVertical: 8, borderRadius: 2 },
	section: {
		flex: 1,
		paddingVertical: 10,
		fontFamily: fonts.displayText,
		fontSize: 19,
		lineHeight: 24,
	},
	subsection: {
		flex: 1,
		paddingVertical: 8,
		fontFamily: fonts.displayText,
		fontSize: 16,
		lineHeight: 21,
	},
	here: { fontFamily: fonts.display },
})
