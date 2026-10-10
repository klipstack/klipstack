import { z } from "zod"
import { defineEndpoint, json } from "../endpoint"

/** The OpenAPI 3.1 document, served without authentication. */
export const getOpenApi = defineEndpoint({
	id: "openapi.get",
	method: "GET",
	path: "/openapi.json",
	scope: "none",
	summary: "This document.",
	response: json(z.record(z.string(), z.unknown())),
	errors: [],
})
