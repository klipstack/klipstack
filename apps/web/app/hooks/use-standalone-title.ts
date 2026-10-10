import { useEffect } from "react"

const SUFFIX = " · Klipstack"

/**
 * Installed as an app, the OS puts "Klipstack - " in front of the window title, so the page's own
 * " · Klipstack" suffix would repeat it. Browser tabs keep the suffix.
 */
export function useStandaloneTitle() {
	useEffect(() => {
		const standalone =
			window.matchMedia("(display-mode: standalone)").matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true
		if (!standalone) return
		const strip = () => {
			if (document.title.endsWith(SUFFIX)) document.title = document.title.slice(0, -SUFFIX.length)
		}
		strip()
		// Route changes rewrite <title>; strip again each time.
		const observer = new MutationObserver(strip)
		observer.observe(document.head, { childList: true, subtree: true, characterData: true })
		return () => observer.disconnect()
	}, [])
}
