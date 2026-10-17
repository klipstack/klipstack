import { defineConfig } from "wxt"

// The one Klipstack server this build saves to, with the browser's session. Read here only, from
// the command line, so the code and the host permission cannot disagree (`.env` files reach the
// code but not this file).
const appUrl = (process.env.WXT_APP_URL || "https://klipstack.com").replace(/\/+$/, "")
const appOrigin = new URL(appUrl)

export default defineConfig({
	srcDir: ".",
	outDir: "dist",
	vite: () => ({ define: { __APP_URL__: JSON.stringify(appUrl) } }),
	manifest: {
		name: "__MSG_name__",
		description: "__MSG_description__",
		default_locale: "en",
		permissions: ["activeTab", "scripting", "contextMenus"],
		// Saving reaches a page through `activeTab`, granted by the click on the button or the menu.
		// Only the Klipstack server needs lasting access, to send the page with the browser's
		// session. Without the port: Firefox refuses patterns with one.
		host_permissions: [`${appOrigin.protocol}//${appOrigin.hostname}/*`],
		action: {
			default_title: "__MSG_actionTitle__",
			// Firefox swaps these with the toolbar theme; Chrome ignores the key and uses `icons`.
			theme_icons: [
				{ light: "icon/mono-dark-16.png", dark: "icon/mono-light-16.png", size: 16 },
				{ light: "icon/mono-dark-32.png", dark: "icon/mono-light-32.png", size: 32 },
			],
		},
		browser_specific_settings: { gecko: { id: "klipstack@klipstack.app" } },
	},
})
