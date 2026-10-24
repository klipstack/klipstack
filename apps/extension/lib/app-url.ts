declare const __APP_URL__: string
declare const __HOST_PERMISSION__: string
declare const __TOKEN_AUTH__: boolean

/**
 * The Klipstack server this build saves to, fixed when it is built: klipstack.com, or another
 * server with `WXT_APP_URL=https://… pnpm --filter @klipstack/extension build`. The extension may
 * reach only this server (its host permission, from the same value in `wxt.config.ts`), so
 * changing it means building again.
 */
export const APP_URL = __APP_URL__

/** The extension's lasting access to that server (`host_permissions`), to save with its session. */
export const HOST_PERMISSION = __HOST_PERMISSION__

/**
 * Whether this build saves with a sign-in of its own (`connect.ts`) instead of the browser's
 * session: Safari's, which sends no SameSite=Lax cookie with an extension's request.
 */
export const TOKEN_AUTH = __TOKEN_AUTH__
