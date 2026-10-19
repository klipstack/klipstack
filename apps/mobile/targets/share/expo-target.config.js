/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
	type: "share",
	name: "KlipstackShare",
	displayName: "Klipstack",
	bundleIdentifier: ".share",
	deploymentTarget: "17.4",
	frameworks: ["UIKit", "SwiftUI", "UniformTypeIdentifiers", "WidgetKit"],
	entitlements: {
		// The app keeps its session in a keychain item of this group (src/lib/session-store.ts).
		"com.apple.security.application-groups":
			config.ios.entitlements["com.apple.security.application-groups"],
	},
})
