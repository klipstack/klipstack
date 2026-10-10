import { StyleSheet } from "react-native"
import type { Colors } from "@/lib/theme"
import { PasteControl } from "../../modules/klip-pasteboard"

/**
 * The system's Paste button (`UIPasteControl`, from `modules/klip-pasteboard`): the tap is the
 * user's consent, so it reads the clipboard without iOS's "Allow Paste" alert. Its word and icon
 * are the system's. A copied URL comes as its address, text as it is, and null when the clipboard
 * had nothing to read: a tap always answers. Nothing without the module.
 */
export function PasteButton({
	onPaste,
	colors,
}: {
	onPaste: (text: string | null) => void
	colors: Colors
}) {
	if (!PasteControl) return null
	return (
		<PasteControl
			backgroundColor={colors.accent}
			foregroundColor={colors.accentFg}
			style={styles.button}
			onPaste={({ nativeEvent }) => onPaste(nativeEvent.text)}
		/>
	)
}

const styles = StyleSheet.create({
	button: { width: 100, height: 36 },
})
