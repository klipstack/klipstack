import type { ConfigContext, ExpoConfig } from "expo/config"

/**
 * app.json, plus what stays out of the repository:
 * - the Apple team that signs device builds: `APPLE_TEAM_ID` in `apps/mobile/.env.local`. Simulator
 *   builds need none.
 * - the build number of an App Store Connect upload: `IOS_BUILD_NUMBER`, set by
 *   `scripts/ios-testflight`. Every upload of a version needs a higher one.
 */
export default ({ config }: ConfigContext): ExpoConfig =>
	({
		...config,
		ios: {
			...config.ios,
			appleTeamId: process.env.APPLE_TEAM_ID || undefined,
			buildNumber: process.env.IOS_BUILD_NUMBER || config.ios?.buildNumber,
		},
	}) as ExpoConfig
