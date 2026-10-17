import { defineConfig } from "wxt"
import { APP_HOSTS, OTHER_HOSTS } from "./lib/hosts"

export default defineConfig({
	srcDir: ".",
	outDir: "dist",
	manifest: ({ manifestVersion }) => ({
		name: "__MSG_name__",
		description: "__MSG_description__",
		default_locale: "en",
		permissions: ["activeTab", "scripting", "storage", "contextMenus"],
		// Saving reaches a page through `activeTab`, granted by the click on the button or the menu.
		// Only the Klipstack server needs lasting access, to send the page with the browser's
		// session: klipstack.com and a local server here, any other address on request (options).
		host_permissions: APP_HOSTS,
		// MV2 (Firefox) has no `optional_host_permissions`: there, origins are optional permissions.
		...(manifestVersion === 2
			? { optional_permissions: OTHER_HOSTS }
			: { optional_host_permissions: OTHER_HOSTS }),
		action: {
			default_title: "__MSG_actionTitle__",
			// Firefox swaps these with the toolbar theme; Chrome ignores the key and uses `icons`.
			theme_icons: [
				{ light: "icon/mono-dark-16.png", dark: "icon/mono-light-16.png", size: 16 },
				{ light: "icon/mono-dark-32.png", dark: "icon/mono-light-32.png", size: 32 },
			],
		},
		options_ui: { page: "options.html", open_in_tab: true },
		browser_specific_settings: { gecko: { id: "klipstack@klipstack.app" } },
	}),
})
