import { returnAppProviderError } from "~/lib/provider-sign-in.server"
import type { Route } from "./+types/app.sign-in.error"

/** Where a provider sign-in from the app's sheet lands when it fails: back to the app. */
export function loader({ request }: Route.LoaderArgs) {
	return returnAppProviderError(request)
}
