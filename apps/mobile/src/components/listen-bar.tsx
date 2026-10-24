import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { t } from "@/lib/i18n"
import { speedLabel } from "@/lib/speech"
import type { Colors } from "@/lib/theme"
import type { SpeechState } from "../../modules/klip-speech"

export type ListenStatus =
	| { kind: "downloading"; received: number; total: number }
	| { kind: "speech"; state: SpeechState; progress: number; minutesLeft: number }

/**
 * The player while an article is read aloud: back and forward a sentence, play and pause, the
 * speed (1×, 1.25×, 1.5×), how far along and the minutes left. While the voices download, their
 * progress and a way to stop. Read to the end of an article without a note, it asks, once, for a
 * thought on it (`onNote`): spoken (`speak`, when dictation is there) or written.
 */
export function ListenBar({
	status,
	speed,
	onPlayPause,
	onSkip,
	onSpeed,
	onClose,
	onNote,
	speak,
	colors,
}: {
	status: ListenStatus
	speed: number
	onPlayPause: () => void
	onSkip: (by: number) => void
	onSpeed: () => void
	onClose: () => void
	/** Asking for a note at the end; absent when the article has one. */
	onNote?: (spoken: boolean) => void
	/** Dictation is there to speak the note. */
	speak: boolean
	colors: Colors
}) {
	const insets = useSafeAreaInsets()
	const bar = colors.floating
	const progress =
		status.kind === "downloading"
			? status.total
				? status.received / status.total
				: 0
			: status.progress
	return (
		<View
			pointerEvents="box-none"
			style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 4 }]}
		>
			<View style={[styles.panel, { backgroundColor: bar.bg, borderColor: bar.border }]}>
				<View style={[styles.track, { backgroundColor: bar.track }]}>
					<View
						style={[
							styles.fill,
							{ backgroundColor: bar.accent, width: `${Math.round(progress * 1000) / 10}%` },
						]}
					/>
				</View>
				{status.kind === "speech" && status.state === "ended" && onNote ? (
					<View style={styles.row}>
						<Text style={[styles.label, styles.ask, { color: bar.fg }]} numberOfLines={2}>
							{t("reader.listenBar.ask")}
						</Text>
						{speak ? (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={t("reader.listenBar.speakNote")}
								onPress={() => onNote(true)}
								hitSlop={6}
								style={({ pressed }) => [
									styles.choice,
									{ backgroundColor: bar.accent },
									pressed && styles.pressed,
								]}
							>
								<SymbolView name="mic.fill" tintColor={bar.accentFg} size={15} />
								<Text style={[styles.choiceText, { color: bar.accentFg }]}>
									{t("reader.listenBar.speak")}
								</Text>
							</Pressable>
						) : null}
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t("reader.listenBar.writeNote")}
							onPress={() => onNote(false)}
							hitSlop={6}
							style={({ pressed }) => [
								styles.choice,
								{ borderColor: bar.track, borderWidth: StyleSheet.hairlineWidth },
								pressed && styles.pressed,
							]}
						>
							<SymbolView name="square.and.pencil" tintColor={bar.fg} size={15} />
							<Text style={[styles.choiceText, { color: bar.fg }]}>
								{t("reader.listenBar.write")}
							</Text>
						</Pressable>
						<Button
							icon="xmark"
							label={t("reader.listenBar.notNow")}
							onPress={onClose}
							tint={bar.fg}
						/>
					</View>
				) : status.kind === "downloading" ? (
					<View style={styles.row}>
						<ActivityIndicator color={bar.mutedFg} />
						<Text style={[styles.label, { color: bar.fg }]}>
							{t("reader.listenBar.downloading", { percent: Math.floor(progress * 100) })}
						</Text>
						<View style={styles.spacer} />
						<Button
							icon="xmark"
							label={t("reader.listenBar.stopDownloading")}
							onPress={onClose}
							tint={bar.fg}
						/>
					</View>
				) : (
					<View style={styles.row}>
						<Button
							icon="gobackward"
							label={t("reader.listenBar.previous")}
							onPress={() => onSkip(-1)}
							tint={bar.fg}
						/>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={
								status.state === "playing"
									? t("reader.listenBar.pause")
									: t("reader.listenBar.play")
							}
							onPress={onPlayPause}
							hitSlop={6}
							style={({ pressed }) => [
								styles.play,
								{ backgroundColor: bar.accent },
								pressed && styles.pressed,
							]}
						>
							{status.state === "loading" ? (
								<ActivityIndicator color={bar.accentFg} />
							) : (
								<SymbolView
									name={status.state === "playing" ? "pause.fill" : "play.fill"}
									tintColor={bar.accentFg}
									size={20}
								/>
							)}
						</Pressable>
						<Button
							icon="goforward"
							label={t("reader.listenBar.next")}
							onPress={() => onSkip(1)}
							tint={bar.fg}
						/>
						<Text style={[styles.label, { color: bar.mutedFg }]} numberOfLines={1}>
							{status.state === "ended"
								? t("reader.listenBar.finished")
								: status.minutesLeft
									? t("reader.listenBar.minutesLeft", { count: status.minutesLeft })
									: ""}
						</Text>
						<View style={styles.spacer} />
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t("reader.listenBar.speed", { speed: speedLabel(speed) })}
							onPress={onSpeed}
							hitSlop={6}
							style={({ pressed }) => [
								styles.speed,
								{ borderColor: bar.track },
								pressed && styles.pressed,
							]}
						>
							<Text style={[styles.speedText, { color: bar.fg }]}>{speedLabel(speed)}</Text>
						</Pressable>
						<Button
							icon="xmark"
							label={t("reader.menu.stopReadingAloud")}
							onPress={onClose}
							tint={bar.fg}
						/>
					</View>
				)}
			</View>
		</View>
	)
}

function Button({
	icon,
	label,
	onPress,
	tint,
}: {
	icon: SymbolViewProps["name"]
	label: string
	onPress: () => void
	tint: string
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			hitSlop={8}
			style={({ pressed }) => [styles.button, pressed && styles.pressed]}
		>
			<SymbolView name={icon} tintColor={tint} size={20} />
		</Pressable>
	)
}

const styles = StyleSheet.create({
	wrap: { position: "absolute", left: 12, right: 12 },
	panel: {
		borderRadius: 18,
		borderWidth: StyleSheet.hairlineWidth,
		overflow: "hidden",
		shadowColor: "#000",
		shadowOpacity: 0.15,
		shadowRadius: 12,
		shadowOffset: { width: 0, height: 4 },
	},
	track: { height: 3 },
	fill: { height: 3 },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingVertical: 10,
		paddingHorizontal: 12,
	},
	button: { padding: 6 },
	play: {
		width: 44,
		height: 44,
		borderRadius: 22,
		alignItems: "center",
		justifyContent: "center",
	},
	label: { fontSize: 14, flexShrink: 1 },
	ask: { flex: 1, fontWeight: "600" },
	choice: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingVertical: 8,
		paddingHorizontal: 12,
		borderRadius: 999,
	},
	choiceText: { fontSize: 15, fontWeight: "600" },
	spacer: { flex: 1 },
	speed: {
		minWidth: 52,
		paddingVertical: 5,
		paddingHorizontal: 8,
		borderRadius: 999,
		borderWidth: StyleSheet.hairlineWidth,
		alignItems: "center",
	},
	speedText: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
	pressed: { opacity: 0.6 },
})
