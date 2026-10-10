import dns from "node:dns"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { Agent, fetch as undiciFetch } from "undici"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fetchBytes, fetchPage, hostIsBlocked, publicConnector } from "../src/fetch"

/** Harmless local listeners: every request they get is a guard that failed. */
const hits: string[] = []
const servers: Server[] = []
const ports: Record<"v4" | "v6", number> = { v4: 0, v6: 0 }

async function listen(host: string): Promise<number> {
	const server = createServer((req, res) => {
		hits.push(`${host} ${req.url}`)
		res.setHeader("content-type", "text/html")
		res.end("<html><title>internal</title></html>")
	})
	servers.push(server)
	await new Promise<void>((resolve) => server.listen(0, host, resolve))
	return (server.address() as AddressInfo).port
}

beforeAll(async () => {
	ports.v4 = await listen("127.0.0.1")
	ports.v6 = await listen("::1")
})

afterAll(async () => {
	await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))))
})

describe("the fetch guard", () => {
	it("refuses IPv6 and IPv4-mapped literals before connecting", async () => {
		const urls = [
			`http://[::1]:${ports.v6}/feed.xml`,
			`http://[0:0:0:0:0:0:0:1]:${ports.v6}/`,
			`http://[::ffff:127.0.0.1]:${ports.v4}/`,
			`http://[::ffff:7f00:1]:${ports.v4}/`,
			`http://127.0.0.1:${ports.v4}/`,
			`http://2130706433:${ports.v4}/`,
			`http://localhost:${ports.v4}/`,
			// Other ways to write loopback, which URL parsing turns into 127.0.0.1 or 0.0.0.0.
			`http://0x7f.1:${ports.v4}/`,
			`http://0177.0.0.1:${ports.v4}/`,
			`http://127.1:${ports.v4}/`,
			`http://0:${ports.v4}/`,
			`http://0.0.0.0:${ports.v4}/`,
		]
		for (const url of urls) {
			await expect(fetchPage(url), url).rejects.toMatchObject({ code: "blocked_host" })
			await expect(fetchBytes(url), url).rejects.toMatchObject({ code: "blocked_host" })
		}
		expect(hits).toEqual([])
	})

	it("judges hostnames as URLs write them", () => {
		expect(hostIsBlocked(new URL("http://[::1]/").hostname)).toBe(true)
		expect(hostIsBlocked(new URL("http://[fd00::1]/").hostname)).toBe(true)
		expect(hostIsBlocked(new URL("http://[2606:4700:4700::1111]/").hostname)).toBe(false)
		expect(hostIsBlocked(new URL("http://[::ffff:8.8.8.8]/").hostname)).toBe(false)
		expect(hostIsBlocked("printer.local")).toBe(true)
		expect(hostIsBlocked("example.com")).toBe(false)
	})

	it("refuses a private address that a lookup let through, before sending anything", async () => {
		// A lookup that checks nothing: only the check after connecting stands in the way.
		const unchecked = ((hostname: string, options: dns.LookupOptions, callback: never) =>
			dns.lookup(hostname, options, callback)) as unknown as typeof dns.lookup
		const dispatcher = new Agent({ connect: publicConnector(unchecked) })
		try {
			for (const [host, port] of [
				["localhost", ports.v4],
				["127.0.0.1", ports.v4],
				["[::1]", ports.v6],
			] as const) {
				const error = await undiciFetch(`http://${host}:${port}/`, { dispatcher }).catch(
					(e: unknown) => e,
				)
				expect((error as { cause?: { code?: string } }).cause?.code, host).toBe("EBLOCKED")
			}
		} finally {
			await dispatcher.close()
		}
		expect(hits).toEqual([])
	})

	it("lets the same listener answer when nothing guards it (the fixture works)", async () => {
		const res = await undiciFetch(`http://[::1]:${ports.v6}/check`)
		expect(res.status).toBe(200)
		expect(hits.splice(0)).toEqual(["::1 /check"])
	})
})
