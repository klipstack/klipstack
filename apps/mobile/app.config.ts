import type { ConfigContext, ExpoConfig } from "expo/config"

/**
 * app.json, plus the Apple team that signs device builds. The team is personal (a free Personal
 * Team now, the paid one later), so it stays out of the repository: `APPLE_TEAM_ID` in
 * `apps/mobile/.env.local`. Simulator builds need none.
 */
export default ({ config }: ConfigContext): ExpoConfig =>
	({
		...config,
		ios: { ...config.ios, appleTeamId: process.env.APPLE_TEAM_ID || undefined },
	}) as ExpoConfig
