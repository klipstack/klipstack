import { requireNativeView, requireOptionalNativeModule } from "expo"
import type { ViewProps } from "react-native"

export type PaperViewProps = ViewProps & {
	/** Which grain: ink-brown specks on light paper, lamp-lit ones in the dark. */
	scheme: "light" | "dark"
}

/**
 * A view on the page's paper: its `backgroundColor` under a faint grain, behind its children. Null
 * without the module (not iOS).
 */
export const PaperView = requireOptionalNativeModule("KlipPaper")
	? requireNativeView<PaperViewProps>("KlipPaper")
	: null
