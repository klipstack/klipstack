import type { Resource } from "i18next"
import en from "./locales/en"
import es from "./locales/es"

export * from "./languages"

export const resources = { en, es } satisfies Resource
export type Resources = typeof en
