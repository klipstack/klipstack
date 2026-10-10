import { defineConfig } from "wxt"

export default defineConfig({
	srcDir: ".",
	outDir: "dist",
	manifest: {
		name: "__MSG_name__",
		description: "__MSG_description__",
		default_locale: "en",
		permissions: ["activeTab", "scripting", "storage", "contextMenus"],
		host_permissions: ["<all_urls>"],
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
	},
})
