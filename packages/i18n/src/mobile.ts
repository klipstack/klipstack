/**
 * The iPhone app's strings (`apps/mobile`), apart from the web's: the app bundles every string of
 * both languages, and the web never loads these. One namespace, its top-level keys by area.
 */
import en from "./locales/mobile/en"
import es from "./locales/mobile/es"

export * from "./languages"

export const mobileResources = { en, es }
export type MobileStrings = typeof en
