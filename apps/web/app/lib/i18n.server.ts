import { createHash } from "node:crypto"
import {
	defaultNamespace,
	fallbackLanguage,
	isLocale,
	namespaces,
	resources,
	supportedLanguages,
} from "@klipstack/i18n"
import { createInstance } from "i18next"
import { initReactI18next } from "react-i18next"
import { createCookie } from "react-router"
import { createI18nextMiddleware } from "remix-i18next"
import { sessionContext } from "./session.server"

/**
 * Changes whenever any UI string changes. The client loads `/api/locales/:lng/:ns?v=<this>`, so
 * translations can be cached for a year and still update on the first load after a deploy.
 */
export const localeVersion = createHash("sha1")
	.update(JSON.stringify(resources))
	.digest("hex")
	.slice(0, 10)

export const localeCookie = createCookie("lng", {
	path: "/",
	sameSite: "lax",
	httpOnly: false,
	maxAge: 60 * 60 * 24 * 365,
})

export const [i18nextMiddleware, getLocale, getInstance] = createI18nextMiddleware({
	detection: {
		supportedLanguages: [...supportedLanguages],
		fallbackLanguage,
		cookie: localeCookie,
		order: ["custom", "searchParams", "cookie", "header"],
		async findLocale({ context }) {
			const locale = context.get(sessionContext)?.user.locale
			return isLocale(locale) ? locale : null
		},
	},
	i18next: {
		resources,
		defaultNS: defaultNamespace,
		ns: namespaces,
		fallbackLng: fallbackLanguage,
		supportedLngs: [...supportedLanguages],
		interpolation: { escapeValue: false },
	},
	plugins: [initReactI18next],
})

/**
 * The middleware only runs for matched routes, so an unknown URL has no instance in the context.
 * Give the error page one in the fallback language rather than failing the render.
 */
export function getInstanceOrFallback(context: Parameters<typeof getInstance>[0]) {
	try {
		return getInstance(context)
	} catch {
		const instance = createInstance()
		void instance.use(initReactI18next).init({
			resources,
			lng: fallbackLanguage,
			fallbackLng: fallbackLanguage,
			defaultNS: defaultNamespace,
			ns: namespaces,
			supportedLngs: [...supportedLanguages],
			interpolation: { escapeValue: false },
			initAsync: false,
		})
		return instance
	}
}

declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: typeof defaultNamespace
		resources: typeof resources.en
	}
}
