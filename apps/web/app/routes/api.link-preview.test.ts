import { beforeEach, expect, it, vi } from "vitest"
import { getUser } from "~/lib/session.server"
import { getLinkPreview } from "~/services/link-preview.server"
import { loader } from "./api.link-preview"

vi.mock("~/lib/session.server", () => ({ getUser: vi.fn() }))
// Only the fetch is mocked: the URL checks and the limit are the real ones.
vi.mock("~/services/link-preview.server", async (original) => ({
	...(await original<typeof import("~/services/link-preview.server")>()),
	getLinkPreview: vi.fn(),
}))

function load(url: string) {
	return loader({
		request: new Request(`http://localhost/api/link-preview?${new URLSearchParams({ url })}`),
	} as never)
}

beforeEach(() => {
	vi.mocked(getUser).mockReturnValue({ id: "preview-test" } as never)
	vi.mocked(getLinkPreview).mockReset().mockResolvedValue(null)
})

it("requires a browser session before fetching", async () => {
	vi.mocked(getUser).mockReturnValue(null)
	expect(await load("https://example.com")).toMatchObject({ init: { status: 401 } })
	expect(getLinkPreview).not.toHaveBeenCalled()
})

it("removes fragments without stripping meaningful query parameters", async () => {
	expect(await load("https://example.com/article?id=42#section")).toEqual({ preview: null })
	expect(getLinkPreview).toHaveBeenCalledWith("https://example.com/article?id=42")
})

it("bounds fetch requests per user", async () => {
	vi.mocked(getUser).mockReturnValue({ id: "preview-quota-test" } as never)
	for (let i = 0; i < 30; i++) await load(`https://example.com/${i}`)
	expect(await load("https://example.com/limited")).toMatchObject({
		init: { status: 429, headers: { "retry-after": expect.any(String) } },
	})
	expect(getLinkPreview).toHaveBeenCalledTimes(30)
})
