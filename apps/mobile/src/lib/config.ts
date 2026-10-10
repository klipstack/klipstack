import { type ClientPlatform, formatClient } from "@klipstack/api-contract/client"
import Constants from "expo-constants"
import { Platform } from "react-native"

/**
 * The server. Release builds (`pnpm ios:release`, and every build for the phone) use production;
 * development builds use the local dev server, which the simulator reaches as the Mac's localhost.
 * `EXPO_PUBLIC_API_URL` overrides both at bundle time, e.g. a development build against
 * production: `EXPO_PUBLIC_API_URL=https://klipstack.com pnpm start`.
 */
export const DEFAULT_API_URL =
	process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? "http://localhost:5180" : "https://klipstack.com")

/**
 * Development builds only: an API key for the dev server (`EXPO_PUBLIC_API_TOKEN` in
 * apps/mobile/.env.local, made with `pnpm --filter @klipstack/web api-key <email>`) that stands in
 * for signing in, so the simulator and agents need no password. Like the CLI's `KLIPSTACK_TOKEN`.
 * Release builds drop the branch, key and all.
 */
export const DEV_API_TOKEN = __DEV__ ? process.env.EXPO_PUBLIC_API_TOKEN || null : null

export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0"

const platform: ClientPlatform = Platform.OS === "android" ? "android" : "ios"

/** The `X-Klipstack-Client` value: the server refuses versions below its minimum. */
export const CLIENT = formatClient(platform, APP_VERSION)

export const USER_AGENT = `klipstack-${platform}/${APP_VERSION}`
