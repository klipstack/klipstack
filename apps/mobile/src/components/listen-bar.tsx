import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { speedLabel } from "@/lib/speech"
import type { Colors } from "@/lib/theme"
import type { SpeechState } from "../../modules/klip-speech"

export type ListenStatus =
	| { kind: "downloading"; received: number; total: number }
	| { kind: "speech"; state: SpeechState; progress: number; minutesLeft: number }

/**
 * The player while an article is read aloud: back and forward a sentence, play and pause, the
 * speed (1×, 1.25×, 1.5×), how far along and the minutes left. While the voices download, their
 * progress and a way to stop.
 */
export function ListenBar({
	status,
	speed,
	onPlayPause,
	onSkip,
	onSpeed,
	onClose,
	colors,
}: {
	status: ListenStatus
	speed: number
	onPlayPause: () => void
	onSkip: (by: number) => void
	onSpeed: () => void
	onClose: () => void
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
				{status.kind === "downloading" ? (
					<View style={styles.row}>
						<ActivityIndicator color={bar.mutedFg} />
						<Text style={[styles.label, { color: bar.fg }]}>
							Downloading voices… {Math.floor(progress * 100)}%
						</Text>
						<View style={styles.spacer} />
						<Button icon="xmark" label="Stop downloading" onPress={onClose} tint={bar.fg} />
					</View>
				) : (
					<View style={styles.row}>
						<Button
							icon="gobackward"
							label="Previous sentence"
							onPress={() => onSkip(-1)}
							tint={bar.fg}
						/>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={status.state === "playing" ? "Pause" : "Play"}
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
							label="Next sentence"
							onPress={() => onSkip(1)}
							tint={bar.fg}
						/>
						<Text style={[styles.label, { color: bar.mutedFg }]} numberOfLines={1}>
							{status.state === "ended"
								? "Finished"
								: status.minutesLeft
									? `${status.minutesLeft} min left`
									: ""}
						</Text>
						<View style={styles.spacer} />
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`Speed ${speedLabel(speed)}`}
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
						<Button icon="xmark" label="Stop reading aloud" onPress={onClose} tint={bar.fg} />
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
