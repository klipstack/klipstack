import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { describe, expect, it, vi } from "vitest"
import { createLibraryMcpServer } from "./index.server"

const userId = "test-mcp-errors"

// A failed query's message holds the SQL and its parameters.
vi.mock("~/services/documents.server", async (original) => ({
	...(await original<typeof import("~/services/documents.server")>()),
	listDocuments: () => {
		throw new Error(`Failed query: select * from documents where user_id = $1\nparams: ${userId}`)
	},
}))

describe("a tool that fails", () => {
	it("answers with a generic error, and the error goes to the log", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
		await createLibraryMcpServer(userId, { canWrite: false }).connect(serverSide)
		const client = new Client({ name: "test", version: "1.0.0" })
		await client.connect(clientSide)

		const result = await client.callTool({ name: "list_library", arguments: {} })
		expect(result.isError).toBe(true)
		expect(JSON.stringify(result.content)).not.toMatch(/select|params|test-mcp-errors/)
		expect(logged).toHaveBeenCalledWith(expect.stringContaining("[mcp] list_library failed"))
		expect(JSON.stringify(logged.mock.calls)).not.toContain(userId)

		await client.close()
		logged.mockRestore()
	})
})
