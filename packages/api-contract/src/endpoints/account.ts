import { defineEndpoint, json } from "../endpoint"
import { Me } from "../schemas"

export const getMe = defineEndpoint({
	id: "me.get",
	method: "GET",
	path: "/me",
	scope: "read",
	summary: "The account behind the token, and what the token may do.",
	response: json(Me),
	errors: [],
})
