import { useEffect, useState } from "react"
import { useNavigation } from "react-router"

/** Thin bar along the top while a navigation takes longer than a beat. */
export function NavigationProgress() {
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"
	const [shown, setShown] = useState(false)
	// The next navigation waits its own beat.
	if (!busy && shown) setShown(false)
	useEffect(() => {
		if (!busy) return
		const id = window.setTimeout(() => setShown(true), 150)
		return () => window.clearTimeout(id)
	}, [busy])
	if (!shown) return null
	return (
		<div
			aria-hidden
			data-testid="navigation-progress"
			className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left animate-[nav-progress_1.2s_ease-out_forwards] bg-accent"
		/>
	)
}
