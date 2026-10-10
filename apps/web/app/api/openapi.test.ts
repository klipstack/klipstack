import { endpoints } from "@klipstack/api-contract"
import { Validator } from "@seriousme/openapi-schema-validator"
import { describe, expect, it } from "vitest"
import { buildOpenApiDocument } from "./openapi.server"

const doc = buildOpenApiDocument({
	endpoints,
	serverUrl: "https://klipstack.test/api/v1",
	version: "test",
})

type Operation = {
	operationId: string
	security: unknown[]
	parameters?: { name: string; in: string; required: boolean; schema: Record<string, unknown> }[]
	responses: Record<string, { content?: Record<string, { schema: unknown }> }>
	"x-scope": string
}

function operations(): Operation[] {
	return Object.values(doc.paths as Record<string, Record<string, Operation>>).flatMap((path) =>
		Object.values(path),
	)
}

describe("openapi document", () => {
	it("is valid OpenAPI 3.1", async () => {
		const result = await new Validator().validate(doc)
		expect(result.errors, JSON.stringify(result.errors, null, 2)).toBeUndefined()
		expect(result.valid).toBe(true)
	})

	it("covers every endpoint once, with its scope and security", () => {
		const ops = operations()
		expect(ops.map((o) => o.operationId).sort()).toEqual(Object.keys(endpoints).sort())
		for (const op of ops) {
			const endpoint = endpoints[op.operationId as keyof typeof endpoints]
			expect(op["x-scope"]).toBe(endpoint.scope)
			expect(op.security).toEqual(endpoint.scope === "none" ? [] : [{ bearerAuth: [] }])
		}
	})

	it("describes errors with the shared Error schema, and hoists registered schemas", () => {
		const me = operations().find((o) => o.operationId === "me.get")
		expect(me?.responses["200"]?.content?.["application/json"]?.schema).toEqual({
			$ref: "#/components/schemas/Me",
		})
		expect(me?.responses["401"]?.content?.["application/json"]?.schema).toEqual({
			$ref: "#/components/schemas/Error",
		})
		const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas
		expect(Object.keys(schemas)).toEqual(expect.arrayContaining(["Error", "Me"]))
		expect(JSON.stringify(doc)).not.toContain("$defs")
		expect(JSON.stringify(doc)).not.toContain('"$schema"')
	})

	it("gives errors with details their shape, per operation", () => {
		const byId = (id: string) => operations().find((o) => o.operationId === id)
		const schemaOf = (id: string, status: string) =>
			JSON.stringify(byId(id)?.responses[status]?.content?.["application/json"]?.schema)
		// 409 on a note is note_changed only: its details are the note.
		expect(schemaOf("articles.setNote", "409")).toContain('"const":"note_changed"')
		expect(schemaOf("articles.setNote", "409")).toContain('"$ref":"#/components/schemas/Note"')
		expect(schemaOf("highlights.create", "409")).toContain("AmbiguousQuoteDetails")
		expect(schemaOf("feeds.follow", "409")).toContain("ChooseFeedDetails")
		// Every 400 is invalid_request, with the issues.
		expect(schemaOf("me.get", "400")).toContain("InvalidRequestDetails")
		// Any call from an app too old to work: 426, with the version to update to.
		expect(schemaOf("me.get", "426")).toContain("ClientOutdatedDetails")
		// Codes without details keep the plain schema.
		expect(schemaOf("me.get", "401")).toBe('{"$ref":"#/components/schemas/Error"}')
	})

	it("lists path params as required and turns :id into {id}", () => {
		for (const [path, ops] of Object.entries(
			doc.paths as Record<string, Record<string, Operation>>,
		)) {
			expect(path).not.toContain(":")
			const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
			for (const op of Object.values(ops))
				expect(
					(op.parameters ?? []).filter((p) => p.in === "path" && p.required).map((p) => p.name),
				).toEqual(names)
		}
	})
})
