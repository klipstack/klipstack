/**
 * Changes made to articles on the way out of a screen (the reader finishing one as it closes),
 * which the lists must wait for and show: a list loads after the changes on their way have landed
 * (`settled`), and loads again when one lands or is undone (`onChange`).
 */

const pending = new Set<Promise<unknown>>()
const listeners = new Set<() => void>()

/** Waits for `change` before lists load, and has them load again once it lands. */
export function track<T>(change: Promise<T>): Promise<T> {
	pending.add(change)
	const done = () => {
		pending.delete(change)
		changed()
	}
	change.then(done, done)
	return change
}

/** The changes on their way, landed or failed. */
export async function settled(): Promise<void> {
	await Promise.allSettled(pending)
}

/** Articles changed: lists load again. */
export function changed(): void {
	for (const listener of listeners) listener()
}

export function onChange(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

// ---- the toast ----

export type Toast = {
	id: number
	message: string
	action?: { label: string; run: () => void }
}

/** How long a toast stays: long enough to notice what changed and undo it. */
export const TOAST_MS = 6000

let toast: Toast | null = null
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
const toastListeners = new Set<() => void>()

function emit() {
	for (const listener of toastListeners) listener()
}

/** Shows a notice at the bottom of the app, over any screen; only the latest is kept. */
export function showToast(next: Omit<Toast, "id">, ms = TOAST_MS): number {
	const id = ++seq
	toast = { id, ...next }
	clearTimeout(timer)
	timer = setTimeout(() => dismissToast(id), ms)
	emit()
	return id
}

export function dismissToast(id: number): void {
	if (toast?.id !== id) return
	clearTimeout(timer)
	toast = null
	emit()
}

export const currentToast = () => toast

export function onToast(listener: () => void): () => void {
	toastListeners.add(listener)
	return () => {
		toastListeners.delete(listener)
	}
}
