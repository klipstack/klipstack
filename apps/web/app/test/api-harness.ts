import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { db, eq, sql, user } from "@klipstack/db"
import { QUEUES } from "@klipstack/queue"
import { createClient } from "@klipstack/sdk"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { env } from "~/lib/env.server"
import { action as apiAction, loader as apiLoader } from "~/routes/api.v1"
import { action as mcpAction, loader as mcpLoader } from "~/routes/mcp"
import { createApiKey } from "~/services/api-keys.server"
import { saveDocument } from "~/services/documents.server"
import { handleExtract } from "../../../worker/src/jobs/extract"

/**
 * The HTTP API (/api/v1) and MCP (/mcp) answered in this process, through their real routes and
 * the real database: what the e2e tests did through a server and a browser, without either.
 */

/** What these routes read of their arguments: only the request. */
type Handler = (args: { request: Request }) => Promise<Response>
const serve = (handler: unknown, request: Request) => (handler as Handler)({ request })

/** A fetch that serves /api/v1 and /mcp from their route modules. */
export async function inProcessFetch(input: RequestInfo | URL, init?: RequestInit) {
	const request = input instanceof Request && !init ? input : new Request(input, init)
	const { pathname } = new URL(request.url)
	const read = request.method === "GET" || request.method === "HEAD"
	if (pathname.startsWith("/api/v1/")) return serve(read ? apiLoader : apiAction, request)
	if (pathname === "/mcp") return serve(read ? mcpLoader : mcpAction, request)
	throw new Error(`${pathname} is not served in process`)
}

/** A raw request to the in-process API, for what the SDK hides (headers, error bodies). */
export function request(path: string, init: RequestInit & { token?: string } = {}) {
	const { token, headers, ...rest } = init
	return inProcessFetch(new URL(path, env.APP_URL), {
		...rest,
		headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
	})
}

/** The SDK as the CLI uses it, against the in-process API. */
export function sdk(token: string) {
	return createClient({
		baseUrl: env.APP_URL,
		token: () => token,
		userAgent: "klipstack-test/1.0",
		fetch: inProcessFetch,
	})
}

/** An MCP client connected to the in-process /mcp; `legacy` speaks as a 2025-era client. */
export async function mcpClient(token: string, { legacy = false } = {}) {
	const client = new Client({ name: "klipstack-test", version: "1.0.0" })
	const transport = new StreamableHTTPClientTransport(new URL("/mcp", env.APP_URL), {
		requestInit: { headers: { authorization: `Bearer ${token}` } },
		fetch: inProcessFetch,
	})
	await client.connect(transport, legacy ? { prior: { kind: "legacy" } } : undefined)
	return client
}

/** Test accounts with an API key; `cleanup` deletes them and what they own. */
export function apiUsers(tag: string) {
	const ids: string[] = []
	async function create(name: string) {
		const id = `test-${tag}-${randomUUID()}`
		const email = `${id}@example.com`
		await db.insert(user).values({ id, name, email, emailVerified: true })
		ids.push(id)
		const key = (await createApiKey(id, "tests")).raw
		return { id, name, email, key, client: sdk(key) }
	}
	async function cleanup() {
		for (const id of ids) await db.delete(user).where(eq(user.id, id))
	}
	return { create, cleanup }
}

const PAGES = join(import.meta.dirname, "../../../../packages/extract/test/fixtures/pages")

export const FIXTURES = {
	joel: {
		file: join(PAGES, "joelonsoftware-joel-test.html"),
		url: "https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/",
		title: "The Joel Test: 12 Steps to Better Code",
	},
	makers: {
		file: join(PAGES, "paulgraham-makers.html"),
		url: "https://paulgraham.com/makersschedule.html",
		title: "Maker's Schedule, Manager's Schedule",
	},
}

/**
 * A page captured as the extension sends it, then extracted by the worker's own job, run here:
 * the article is ready when this returns.
 */
export async function captured(
	userId: string,
	page: { file?: string; html?: string; url: string },
): Promise<string> {
	const html = page.html ?? readFileSync(page.file!, "utf8")
	const { document } = await saveDocument({ userId, url: page.url, html, source: "extension" })
	await extract(document.id)
	return document.id
}

/**
 * Runs the worker's extraction job for a saved article, and takes the job off the queue as the
 * worker would: a job left waiting there would make the next save of that article wait behind it.
 */
export async function extract(documentId: string) {
	await db.execute(
		sql`delete from pgboss.job where name = ${QUEUES.extract} and data->>'documentId' = ${documentId} and state in ('created', 'retry')`,
	)
	await handleExtract({
		id: randomUUID(),
		name: "extract",
		data: { documentId },
		retryCount: 0,
		retryLimit: 3,
	} as unknown as Parameters<typeof handleExtract>[0])
}
