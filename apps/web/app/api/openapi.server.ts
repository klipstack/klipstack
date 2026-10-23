import {
	COMMON_ERRORS,
	type DetailedErrorCode,
	type Endpoint,
	ERROR_DETAILS,
	ERROR_STATUS,
	ErrorBody,
	type ErrorCode,
} from "@klipstack/api-contract"
import { z } from "zod"

/**
 * The OpenAPI 3.1 document, generated from the contract: parameters and bodies from the input side
 * of their zod schemas, responses from the output side. Schemas registered with an id become
 * `components/schemas`.
 */

type JsonSchema = Record<string, unknown>

export interface OpenApiOptions {
	endpoints: Record<string, Endpoint>
	/** `<APP_URL>/api/v1` */
	serverUrl: string
	version: string
}

export function buildOpenApiDocument({
	endpoints,
	serverUrl,
	version,
}: OpenApiOptions): JsonSchema {
	const schemas: Record<string, JsonSchema> = {}

	function convert(schema: z.ZodType, io: "input" | "output"): JsonSchema {
		const json = z.toJSONSchema(schema, {
			io,
			target: "draft-2020-12",
			unrepresentable: "any",
			override: ({ zodSchema, jsonSchema }) => {
				// z.stringbool() parses "true"/"false": a boolean on the wire, not free text.
				const def = zodSchema._zod.def
				if (def.type === "pipe" && def.out._zod.def.type === "boolean") {
					for (const key of Object.keys(jsonSchema)) delete (jsonSchema as JsonSchema)[key]
					;(jsonSchema as JsonSchema).type = "boolean"
				}
			},
		}) as JsonSchema
		const { $schema: _dialect, $defs, ...rest } = json
		for (const [name, def] of Object.entries(($defs ?? {}) as Record<string, JsonSchema>))
			schemas[name] = rewriteRefs(def) as JsonSchema
		return rewriteRefs(rest) as JsonSchema
	}

	convert(ErrorBody, "output")
	const errorRef = { $ref: "#/components/schemas/Error" }
	/** The Error schema, narrowed to a code whose `details` have a known shape. */
	const detailedError = (code: DetailedErrorCode): JsonSchema => ({
		allOf: [
			errorRef,
			{
				type: "object",
				properties: {
					error: {
						type: "object",
						required: ["details"],
						properties: {
							code: { const: code },
							details: convert(ERROR_DETAILS[code], "output"),
						},
					},
				},
			},
		],
	})
	/** One status's errors: any of the detailed ones, or the plain Error for the rest. */
	const errorContent = (codes: ErrorCode[]) => {
		const detailed = codes.filter((code): code is DetailedErrorCode => code in ERROR_DETAILS)
		const schema = detailed.length
			? {
					anyOf: [
						...detailed.map(detailedError),
						...(detailed.length < codes.length ? [errorRef] : []),
					],
				}
			: errorRef
		return { "application/json": { schema } }
	}

	const paths: Record<string, Record<string, JsonSchema>> = {}
	const tags = new Set<string>()
	for (const endpoint of Object.values(endpoints)) {
		const tag = endpoint.id.split(".")[0] ?? endpoint.id
		tags.add(tag)
		const parameters: JsonSchema[] = []
		if (endpoint.params) {
			const json = convert(endpoint.params, "input")
			for (const [name, schema] of Object.entries(json.properties as Record<string, JsonSchema>))
				parameters.push({ name, in: "path", required: true, schema })
		}
		if (endpoint.query) {
			const json = convert(endpoint.query, "input")
			const required = new Set((json.required as string[] | undefined) ?? [])
			for (const [name, schema] of Object.entries(json.properties as Record<string, JsonSchema>))
				parameters.push({ name, in: "query", required: required.has(name), schema })
		}

		const responses: Record<string, JsonSchema> = {}
		const kind = endpoint.response
		if (kind.kind === "json") {
			const schema = convert(kind.schema, "output")
			for (const status of kind.statuses)
				responses[status] = {
					description: SUCCESS[status],
					content: { "application/json": { schema } },
				}
		} else if (kind.kind === "text") {
			responses[200] = {
				description: "OK",
				content: {
					[kind.contentType.split(";")[0] ?? "text/plain"]: { schema: { type: "string" } },
				},
			}
		} else if (kind.kind === "binary") {
			responses[200] = {
				description: "The file, with its own content type.",
				content: { "*/*": { schema: { type: "string", format: "binary" } } },
			}
		} else if (kind.kind === "events") {
			responses[200] = {
				description:
					"Server-sent events, sent as they come: each `data:` line is one JSON value of this schema.",
				content: { "text/event-stream": { schema: convert(kind.schema, "output") } },
			}
		} else {
			responses[204] = { description: "Done; no content." }
		}
		const byStatus = new Map<number, ErrorCode[]>()
		const own: ErrorCode[] = [
			...(endpoint.body ? (["too_large", "request_timeout"] as const) : []),
			// The client is not one the endpoint is for.
			...(endpoint.clients ? (["forbidden"] as const) : []),
			...endpoint.errors,
		]
		// An endpoint may list one of these too, for a reason of its own (`too_large`).
		for (const code of new Set([...COMMON_ERRORS, ...own])) {
			if (endpoint.scope === "none" && AUTH_ERRORS.has(code)) continue
			const list = byStatus.get(ERROR_STATUS[code]) ?? []
			list.push(code)
			byStatus.set(ERROR_STATUS[code], list)
		}
		for (const [status, codes] of [...byStatus].sort(([a], [b]) => a - b))
			responses[status] = {
				description: `Error: ${codes.join(", ")}`,
				content: errorContent(codes),
			}

		const operation: JsonSchema = {
			operationId: endpoint.id,
			tags: [tag],
			...(endpoint.summary ? { summary: endpoint.summary } : {}),
			...(endpoint.clients
				? {
						description: [
							`Only for ${endpoint.clients.audience}: an OAuth access token issued to ${endpoint.clients.ids.map((id) => `\`${id}\``).join(" or ")}.`,
							"The CLI and other OAuth clients get `403 forbidden`, whatever their scopes.",
							...(endpoint.clients.note ? [endpoint.clients.note] : []),
						].join(" "),
					}
				: {}),
			"x-scope": endpoint.scope,
			...(endpoint.clients ? { "x-clients": endpoint.clients.ids } : {}),
			security: endpoint.scope === "none" ? [] : [{ bearerAuth: [] }],
			...(parameters.length ? { parameters } : {}),
			...(endpoint.body
				? {
						requestBody: {
							required: true,
							content: { "application/json": { schema: convert(endpoint.body, "input") } },
						},
					}
				: {}),
			responses,
		}
		const path = endpoint.path.replace(/:(\w+)/g, "{$1}")
		paths[path] = { ...paths[path], [endpoint.method.toLowerCase()]: operation }
	}

	return {
		openapi: "3.1.0",
		info: {
			title: "Klipstack API",
			version,
			description:
				"Klipstack's HTTP API for programs: the CLI, the browser extension and scripts. Alpha: endpoints, fields and error codes may change without notice. Authenticate with `Authorization: Bearer <token>`: an OAuth access token for the `/api` resource with the `library:read` scope (`library:write` for changes; `x-scope` says which each operation needs). Operations with `x-clients` answer only tokens issued to those OAuth clients: the reader's AI is for Klipstack's own apps.",
		},
		servers: [{ url: serverUrl }],
		tags: [...tags].map((name) => ({ name })),
		paths,
		components: {
			schemas,
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					description: "An OAuth access token issued for `<origin>/api`.",
				},
			},
		},
	}
}

const SUCCESS: Record<number, string> = { 200: "OK", 201: "Created", 202: "Accepted" }
const AUTH_ERRORS: ReadonlySet<ErrorCode> = new Set([
	"unauthorized",
	"insufficient_scope",
	"rate_limited",
])

/** `#/$defs/X` → `#/components/schemas/X`, at any depth. */
function rewriteRefs(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(rewriteRefs)
	if (!node || typeof node !== "object") return node
	const out: JsonSchema = {}
	for (const [key, value] of Object.entries(node as JsonSchema)) {
		out[key] =
			key === "$ref" && typeof value === "string" && value.startsWith("#/$defs/")
				? `#/components/schemas/${value.slice("#/$defs/".length)}`
				: rewriteRefs(value)
	}
	return out
}
