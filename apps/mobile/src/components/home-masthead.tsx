import type { FinishedLately, NextEdition } from "@klipstack/sdk"
import { Linking, Pressable, StyleSheet, Text, View } from "react-native"
import { MarkerText } from "@/components/marker-text"
import {
	editionEar,
	editionNudge,
	finishedLine,
	greeting,
	mastheadDate,
	partOfDay,
} from "@/lib/home-masthead"
import { t } from "@/lib/i18n"
import { type Colors, fonts } from "@/lib/theme"

/**
 * Home's top, as the web's masthead on a phone, the morning paper's front page: the date over a
 * rule, a greeting with the reader's name marked in, what was finished this past week, and the
 * next edition. Editions are put together on the web: the ear opens it. When one is due
 * (`nudging`), why, with "Not now". A double rule under it all, as a newspaper sets its masthead.
 */
export function HomeMasthead({
	name,
	now,
	finished,
	edition,
	nudging,
	onNotNow,
	colors,
}: {
	/** The reader's name, once the account is known: the greeting comes first, the name after. */
	name: string | null
	now: Date
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
	const hello = greeting(partOfDay(now), name)
	const open = () => {
		if (edition) void Linking.openURL(edition.url)
	}
	const action = (label: string) => (
		<Text accessibilityRole="link" onPress={open} style={{ color: colors.accent }}>
			{label}
		</Text>
	)
	return (
		<View style={styles.masthead}>
			<Text
				testID="home-date"
				style={[styles.date, { color: colors.mutedFg, borderColor: colors.fg }]}
			>
				{mastheadDate(now)}
			</Text>
			<View
				testID="home-greeting"
				accessible
				accessibilityRole="header"
				accessibilityLabel={hello.before + (hello.name ?? "")}
				style={styles.greeting}
			>
				<Text style={[styles.hello, { color: colors.fg }]}>{hello.before}</Text>
				{hello.name ? (
					<MarkerText
						text={hello.name}
						color="yellow"
						seed="greeting"
						colors={colors}
						style={[styles.hello, { color: colors.fg }]}
					/>
				) : null}
			</View>
			{line ? (
				<Text testID="home-finished" style={[styles.finished, { color: colors.mutedFg }]}>
					{line.before}
					{line.title ? <Text style={{ color: colors.fg }}>{line.title}</Text> : null}
					{line.after}
				</Text>
			) : null}
			{ear ? (
				<Text testID="home-edition" style={[styles.ear, { color: colors.mutedFg }]}>
					{t("home.masthead.nextEdition")}
					<Text style={{ color: colors.fg }}>{ear.count}</Text>
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
								<Text style={[styles.buttonText, { color: colors.fg }]}>
									{t("home.masthead.putTogether")}
								</Text>
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
							<Text style={[styles.buttonText, { color: colors.fg }]}>
								{t("home.masthead.notNow")}
							</Text>
						</Pressable>
					</View>
				</View>
			) : null}
			<View style={[styles.rules, { borderColor: colors.fg }]} />
		</View>
	)
}

const styles = StyleSheet.create({
	masthead: { marginHorizontal: 16, gap: 8 },
	date: { fontSize: 14, paddingBottom: 6, borderBottomWidth: 1 },
	greeting: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", paddingTop: 10 },
	hello: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.3 },
	// The web's 3px double rule: two lines with a gap between.
	rules: { height: 4, borderTopWidth: 1, borderBottomWidth: 1, marginTop: 8 },
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
