import { isLocale, namespaces, resources } from "@klipstack/i18n"
import { data } from "react-router"
import { localeVersion } from "~/lib/i18n.server"
import type { Route } from "./+types/api.locales"

export async function loader({ params, request }: Route.LoaderArgs) {
	const { lng, ns } = params
	if (!isLocale(lng)) return data({ error: "unsupported language" }, { status: 400 })
	if (!(namespaces as readonly string[]).includes(ns))
		return data({ error: "unknown namespace" }, { status: 400 })
	const headers = new Headers()
	const versioned = new URL(request.url).searchParams.get("v") === localeVersion
	headers.set(
		"Cache-Control",
		versioned && process.env.NODE_ENV === "production"
			? "public, max-age=31536000, immutable"
			: "no-cache",
	)
	return data(resources[lng][ns as keyof typeof resources.en], { headers })
}
