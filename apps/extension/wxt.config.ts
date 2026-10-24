import { defineConfig } from "wxt"

// The one Klipstack server this build saves to, with the browser's session. Read here only, from
// the command line, so the code and the host permission cannot disagree (`.env` files reach the
// code but not this file).
const appUrl = (process.env.WXT_APP_URL || "https://klipstack.com").replace(/\/+$/, "")
const appOrigin = new URL(appUrl)
// Without the port: Firefox refuses patterns with one.
const hostPermission = `${appOrigin.protocol}//${appOrigin.hostname}/*`

export default defineConfig({
	srcDir: ".",
	// The e2e spec builds a copy of its own, for its server, beside the real build.
	outDir: process.env.WXT_OUT_DIR || "dist",
	vite: () => ({
		define: {
			__APP_URL__: JSON.stringify(appUrl),
			__HOST_PERMISSION__: JSON.stringify(hostPermission),
		},
	}),
	// Safari builds as Manifest V3 (`--mv3` in `build:safari`): the background calls `browser.action`.
	manifest: ({ browser }) => ({
		name: "__MSG_name__",
		description: "__MSG_description__",
		default_locale: "en",
		permissions: ["activeTab", "scripting", "contextMenus"],
		// Saving reaches a page through `activeTab`, granted by the click on the button or the menu.
		// Only the Klipstack server needs lasting access, to send the page with the browser's
		// session. Safari grants it only when the reader allows it: the background asks on a save.
		host_permissions: [hostPermission],
		action: {
			default_title: "__MSG_actionTitle__",
			// Firefox swaps these with the toolbar theme; Chrome ignores the key and uses `icons`.
			// Apple's packager reports keys Safari doesn't know: Safari's manifest leaves them out.
			...(browser === "safari"
				? {}
				: {
						theme_icons: [
							{ light: "icon/mono-dark-16.png", dark: "icon/mono-light-16.png", size: 16 },
							{ light: "icon/mono-dark-32.png", dark: "icon/mono-light-32.png", size: 32 },
						],
					}),
		},
		...(browser === "safari"
			? {}
			: { browser_specific_settings: { gecko: { id: "klipstack@klipstack.app" } } }),
	}),
})
