/**
 * The Klipstack server this build saves to, fixed when it is built: klipstack.com, or another
 * server with `WXT_APP_URL=https://… pnpm --filter @klipstack/extension build`. The extension may
 * reach only this server (its host permission), so changing it means building again.
 */
export const APP_URL = (import.meta.env.WXT_APP_URL || "https://klipstack.com").replace(/\/+$/, "")
