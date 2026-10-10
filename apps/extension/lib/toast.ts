/**
 * In-page notice shown after a save. Injected with `scripting.executeScript({ func, args })`, so it
 * must be self-contained: no imports, no references to module scope. Styles live in a shadow root
 * so the page's CSS cannot touch them, and the host is removed before the page is captured.
 */
export const TOAST_HOST_ID = "klipstack-toast-host"

export interface ToastOptions {
	kind: "saving" | "saved" | "error"
	title: string
	/** Optional action shown after the title (e.g. "Open" → reader). */
	link?: { label: string; href: string }
	/** Auto-dismiss delay; `0` keeps it until replaced. */
	ms?: number
}

export function showToast(opts: ToastOptions): void {
	const HOST_ID = "klipstack-toast-host"
	document.getElementById(HOST_ID)?.remove()
	const host = document.createElement("div")
	host.id = HOST_ID
	host.setAttribute("style", "all:initial;position:fixed;top:16px;right:16px;z-index:2147483647")
	const root = host.attachShadow({ mode: "open" })

	const style = document.createElement("style")
	style.textContent = `
		:host { --toast-bg:#1a1d23; --toast-fg:#fbfaf7; --toast-link:#82bdf8;
			--toast-spinner:#62656b; color-scheme:light }
		@media (prefers-color-scheme:dark) {
			:host { --toast-bg:#e9e8e3; --toast-fg:#111419; --toast-link:#0f5ab5;
				--toast-spinner:#aaaeb3; color-scheme:dark }
		}
		.toast { display:flex; align-items:center; gap:10px; max-width:360px; padding:10px 14px;
			border-radius:10px; background:var(--toast-bg); color:var(--toast-fg); font:500 13px/1.4 -apple-system,
			BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.28);
			animation:in .18s ease-out; cursor:default }
		.icon { flex:none; width:18px; height:18px; border-radius:50%; display:grid; place-items:center;
			font-size:12px; font-weight:700; color:#fff }
		.saved .icon { background:#15803d }
		.error .icon { background:#b91c1c }
		.saving .icon { border:2px solid var(--toast-spinner); border-top-color:var(--toast-link);
			animation:spin .8s linear infinite }
		a { color:var(--toast-link); text-decoration:none; font-weight:600; margin-left:2px }
		a:hover { text-decoration:underline }
		a:focus-visible { outline:2px solid var(--toast-link); outline-offset:3px; border-radius:2px }
		@keyframes in { from { opacity:0; transform:translateY(-6px) } to { opacity:1; transform:none } }
		@keyframes spin { to { transform:rotate(360deg) } }
	`
	root.appendChild(style)

	const toast = document.createElement("div")
	toast.className = `toast ${opts.kind}`
	toast.setAttribute("role", "status")
	const icon = document.createElement("span")
	icon.className = "icon"
	icon.textContent = opts.kind === "saved" ? "✓" : opts.kind === "error" ? "!" : ""
	toast.appendChild(icon)
	const text = document.createElement("span")
	text.textContent = opts.title
	toast.appendChild(text)
	if (opts.link) {
		const a = document.createElement("a")
		a.href = opts.link.href
		a.target = "_blank"
		a.rel = "noopener"
		a.textContent = opts.link.label
		toast.appendChild(a)
	}
	toast.addEventListener("click", (e) => {
		if ((e.target as Element).closest("a")) return
		host.remove()
	})
	root.appendChild(toast)
	document.documentElement.appendChild(host)

	const ms = opts.ms ?? (opts.kind === "saving" ? 0 : 4000)
	if (ms > 0) setTimeout(() => host.remove(), ms)
}
