import { useSyncExternalStore } from "react"

export interface Toast {
	id: number
	message: string
	/** Posts `intent` (plus `fields`) to `action` when pressed. */
	undo?: { action: string; intent: string; label: string; fields?: Record<string, string> }
	/** A navigation offered alongside the message. */
	link?: { label: string; to: string }
	/** A warning: marked with an icon, and given longer to be read. */
	warn?: boolean
	ms?: number
}

/** A warning is read, not just glimpsed. */
const WARN_MS = 15_000
/** Undo for something that took writing, such as a note: time to notice what went with it. */
export const LONG_UNDO_MS = 15_000
/** Left after the pointer or the focus leaves a held toast: time to read it again. */
const AFTER_HOLD_MS = 3_000

let toasts: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()
const EMPTY: Toast[] = []

// The one toast's timer. Held while the pointer is over it or the focus is in it.
let timer: number | undefined
let deadline = 0
let held = false
let remaining = 0
/** Where the focus was when the toast appeared: it goes back there when the toast leaves. */
let focusBefore: Element | null = null

function emit() {
	for (const listener of listeners) listener()
}

function schedule(id: number, ms: number) {
	window.clearTimeout(timer)
	deadline = Date.now() + ms
	timer = window.setTimeout(() => dismissToast(id), ms)
}

/** Shows a transient notice at the bottom of the screen; only the latest one is kept. */
export function showToast(toast: Omit<Toast, "id">): number {
	const id = ++seq
	toasts = [{ id, ...toast }]
	held = false
	focusBefore = document.activeElement
	emit()
	schedule(id, toast.ms ?? (toast.warn ? WARN_MS : 6000))
	return id
}

export function dismissToast(id: number) {
	if (!toasts.some((t) => t.id === id)) return
	window.clearTimeout(timer)
	toasts = toasts.filter((t) => t.id !== id)
	emit()
}

/** The pointer or the focus came in: the toast stays until both leave (WCAG 2.2.1). */
export function holdToast(id: number) {
	if (toasts[0]?.id !== id || held) return
	held = true
	remaining = deadline - Date.now()
	window.clearTimeout(timer)
}

/** Both left: the rest of its time, and never less than a moment to reread it. */
export function releaseToast(id: number) {
	if (toasts[0]?.id !== id || !held) return
	held = false
	schedule(id, Math.max(remaining, AFTER_HOLD_MS))
}

/**
 * The toast left while the focus was in it (its Undo or Close pressed): the focus goes back to
 * where it was before the toast, when that is still on the page, instead of to the body.
 */
export function restoreFocusFromToast() {
	const target = focusBefore
	focusBefore = null
	if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true })
}

export function useToasts(): Toast[] {
	return useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange)
			return () => listeners.delete(onChange)
		},
		() => toasts,
		() => EMPTY,
	)
}
