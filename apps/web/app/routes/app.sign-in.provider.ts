import { startAppProviderSignIn } from "~/lib/provider-sign-in.server"
import type { Route } from "./+types/app.sign-in.provider"

/** `GET /app/sign-in/google` or `/github`, in the app's sign-in sheet: off to the provider. */
export function loader({ request, params }: Route.LoaderArgs) {
	return startAppProviderSignIn(request, params.provider)
}
