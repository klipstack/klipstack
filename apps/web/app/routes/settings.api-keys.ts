import { redirect } from "react-router"

/** API keys are retired: apps connect with OAuth, listed in Connected apps. */
export function loader() {
	return redirect("/settings/connected-apps")
}
