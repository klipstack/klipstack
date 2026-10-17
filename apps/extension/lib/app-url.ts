declare const __APP_URL__: string

/**
 * The Klipstack server this build saves to, fixed when it is built: klipstack.com, or another
 * server with `WXT_APP_URL=https://… pnpm --filter @klipstack/extension build`. The extension may
 * reach only this server (its host permission, from the same value in `wxt.config.ts`), so
 * changing it means building again.
 */
export const APP_URL = __APP_URL__
