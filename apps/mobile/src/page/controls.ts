export type ControlsState = { shown: boolean; from: number }

/**
 * Whether the app's controls show, as the page scrolls to `y` (of `max`): they hide while the
 * reader scrolls down and come back when they scroll up or near the top. A turn counts once the
 * page has moved 24 points from the furthest point in the direction it was going (`from`), so
 * small movements don't flicker them; the bounce past either end changes nothing.
 */
export function controlsStep(state: ControlsState, y: number, max: number): ControlsState {
	if (y < 0 || y > max) return state
	if (y < 40) return { shown: true, from: y }
	if (state.shown) {
		const top = Math.min(state.from, y)
		return y - top > 24 ? { shown: false, from: y } : { shown: true, from: top }
	}
	const bottom = Math.max(state.from, y)
	return bottom - y > 24 ? { shown: true, from: y } : { shown: false, from: bottom }
}
