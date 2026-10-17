const fs = require("node:fs")
const { IOSConfig, withFinalizedMod } = require("expo/config-plugins")

/**
 * Settings @bacons/apple-targets has no option for, on the targets it writes. It writes them at its
 * own step, so this runs once every other change to the project is made.
 *
 * - The extensions run on the devices the app runs on: iPhone only while `ios.supportsTablet` is
 *   false (the targets come as iPhone and iPad).
 * - The share extension may reach the local dev server (`NSAllowsLocalNetworking` in
 *   targets/share/Info.plist) only in development builds: a build phase removes the key from the
 *   built Info.plist of a Release build, before it is signed.
 */
const EXTENSIONS = ["KlipstackShare", "KlipstackWidget"]
const SHARE = "KlipstackShare"
const PHASE = "Drop local networking from Release"
const SCRIPT = [
	'if [ "$CONFIGURATION" = "Release" ]; then',
	'  /usr/libexec/PlistBuddy -c "Delete :NSAppTransportSecurity:NSAllowsLocalNetworking" "$TARGET_BUILD_DIR/$INFOPLIST_PATH" 2>/dev/null || true',
	"fi",
].join("\n")

module.exports = function withExtensionSettings(config) {
	return withFinalizedMod(config, [
		"ios",
		(config) => {
			const root = config.modRequest.projectRoot
			const project = IOSConfig.XcodeUtils.getPbxproj(root)
			const objects = project.hash.project.objects
			const targets = Object.entries(project.pbxNativeTargetSection()).filter(
				([, t]) => typeof t === "object" && EXTENSIONS.includes(t.name),
			)
			if (targets.length !== EXTENSIONS.length)
				throw new Error(`with-extension-settings: expected the targets ${EXTENSIONS.join(", ")}`)

			const family = config.ios?.supportsTablet ? '"1,2"' : "1"
			for (const [, target] of targets) {
				const list = objects.XCConfigurationList[target.buildConfigurationList]
				for (const { value } of list.buildConfigurations)
					objects.XCBuildConfiguration[value].buildSettings.TARGETED_DEVICE_FAMILY = family
			}

			const [shareId] = targets.find(([, t]) => t.name === SHARE)
			const present = Object.values(objects.PBXShellScriptBuildPhase ?? {}).some(
				(p) => typeof p === "object" && p.name === `"${PHASE}"`,
			)
			if (!present)
				project.addBuildPhase([], "PBXShellScriptBuildPhase", PHASE, shareId, {
					shellPath: "/bin/sh",
					shellScript: SCRIPT,
					// After Xcode wrote the Info.plist: the phase reads it.
					inputPaths: ['"$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)"'],
				})
			fs.writeFileSync(IOSConfig.Paths.getPBXProjectPath(root), project.writeSync())
			return config
		},
	])
}
