import { redirect } from "react-router"
import { signOutHeaders } from "~/lib/session.server"
import type { Route } from "./+types/logout"

export async function action({ request }: Route.ActionArgs) {
	throw redirect("/login", { headers: await signOutHeaders(request) })
}

export async function loader() {
	throw redirect("/")
}
