import type { FinishedLately, NextEdition } from "@klipstack/sdk"
import { Linking, Pressable, StyleSheet, Text, View } from "react-native"
import { editionEar, editionNudge, finishedLine } from "@/lib/home-masthead"
import type { Colors } from "@/lib/theme"

/**
 * Home's top, as the web's masthead: what was finished this past week, and the next edition in
 * its corner. Editions are put together on the web: the ear opens it. When one is due (`nudging`),
 * why, with "Not now". Nothing at all when there is nothing to say.
 */
export function HomeMasthead({
	finished,
	edition,
	nudging,
	onNotNow,
	colors,
}: {
	finished: FinishedLately | null
	edition: NextEdition | null
	/** Whether to say why an edition is due: not in a topic, nor with a time chosen. */
	nudging: boolean
	onNotNow: () => void
	colors: Colors
}) {
	const line = finished && finishedLine(finished)
	const ear = edition && editionEar(edition)
	const nudge = nudging && edition ? editionNudge(edition) : null
	if (!line && !ear && !nudge) return null
	const open = () => {
		if (edition) void Linking.openURL(edition.url)
	}
	const action = (label: string) => (
		<Text accessibilityRole="link" onPress={open} style={{ color: colors.accent }}>
			{label}
		</Text>
	)
	return (
		<View style={[styles.masthead, { borderBottomColor: colors.border }]}>
			{line ? (
				<Text testID="home-finished" style={[styles.finished, { color: colors.mutedFg }]}>
					{line.before}
					{line.title ? <Text style={{ color: colors.fg }}>{line.title}</Text> : null}
					{line.after}
				</Text>
			) : null}
			{ear ? (
				<Text testID="home-edition" style={[styles.ear, { color: colors.mutedFg }]}>
					Your next edition: <Text style={{ color: colors.fg }}>{ear.count}</Text>
					{" · "}
					{action(ear.action)}
				</Text>
			) : null}
			{nudge ? (
				<View testID="home-edition-nudge" style={styles.nudge}>
					<View style={styles.reason}>
						{/* Amber, as the web's dot for an edition due. */}
						<View style={[styles.dot, { backgroundColor: colors.favorite }]} />
						<Text style={[styles.ear, styles.grow, { color: colors.fg }]}>{nudge}</Text>
					</View>
					<View style={styles.buttons}>
						{/* Without an ear, the way to the editor is here. */}
						{ear ? null : (
							<Pressable
								accessibilityRole="link"
								onPress={open}
								style={({ pressed }) => [
									styles.button,
									{ borderColor: colors.border },
									pressed && styles.pressed,
								]}
							>
								<Text style={[styles.buttonText, { color: colors.fg }]}>Put it together</Text>
							</Pressable>
						)}
						<Pressable
							accessibilityRole="button"
							onPress={onNotNow}
							style={({ pressed }) => [
								styles.button,
								{ borderColor: colors.border },
								pressed && styles.pressed,
							]}
						>
							<Text style={[styles.buttonText, { color: colors.fg }]}>Not now</Text>
						</Pressable>
					</View>
				</View>
			) : null}
		</View>
	)
}

const styles = StyleSheet.create({
	masthead: {
		marginHorizontal: 16,
		gap: 8,
		paddingBottom: 16,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	finished: { fontFamily: "Iowan Old Style", fontStyle: "italic", fontSize: 18, lineHeight: 24 },
	ear: { fontSize: 14, lineHeight: 20 },
	nudge: { gap: 10 },
	reason: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
	dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
	grow: { flex: 1 },
	buttons: { flexDirection: "row", gap: 8, paddingLeft: 16 },
	button: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
	buttonText: { fontSize: 14, fontWeight: "500" },
	pressed: { opacity: 0.6 },
})
