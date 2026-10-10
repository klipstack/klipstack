import { randomUUID } from "node:crypto"
import { canonicalText } from "@klipstack/anchor"
import { db, documents, documentVersions, eq, pool, user } from "@klipstack/db"
import { JSDOM } from "jsdom"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const notify = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@klipstack/db", async (original) => ({
	...(await original<typeof import("@klipstack/db")>()),
	notifyDocumentEvent: notify,
}))

const { handleImages } = await import("./images")

const userId = `images-${randomUUID()}`
const HTML = '<p>Before <img src="https://img.example/a.png" srcset="x 2x"> after</p>'
const TEXT = canonicalText(new JSDOM(`<!doctype html><body>${HTML}</body>`).window.document.body)

beforeAll(async () => {
	await db.insert(user).values({ id: userId, name: "Images", email: `${userId}@example.com` })
})
beforeEach(() => notify.mockClear())
afterAll(async () => {
	await db.delete(user).where(eq(user.id, userId))
	await pool.end()
})

async function article() {
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://example.com/${randomUUID()}`,
			urlHash: randomUUID(),
			status: "ready",
		})
		.returning()
	return { doc: doc!, version: await addVersion(doc!.id, 1) }
}

async function addVersion(documentId: string, n: number) {
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId,
			version: n,
			html: HTML,
			text: TEXT,
			textHash: "hash",
			extractor: "test",
			extractorVersion: "1",
		})
		.returning()
	await db
		.update(documents)
		.set({ currentVersionId: version!.id })
		.where(eq(documents.id, documentId))
	return version!
}

/** A download that waits at a barrier, so the test can change the article while it "runs". */
function delayedIngest() {
	let began!: () => void
	let release!: () => void
	const started = new Promise<void>((resolve) => {
		began = resolve
	})
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const assetId = randomUUID()
	const ingestImage = vi.fn(async () => {
		began()
		await gate
		return { id: assetId, width: 100, height: 100 }
	})
	return { ingestImage, started, release, assetId }
}

const state = async (documentId: string, versionId: string) => {
	const [doc] = await db.select().from(documents).where(eq(documents.id, documentId))
	const [version] = await db
		.select()
		.from(documentVersions)
		.where(eq(documentVersions.id, versionId))
	return { doc, version }
}

describe("handleImages", () => {
	it("publishes html, flag and thumbnail together for the current version", async () => {
		const { doc, version } = await article()
		const { ingestImage, release, assetId } = delayedIngest()
		release()
		const outcome = await handleImages({ data: { versionId: version.id } }, { ingestImage })
		expect(outcome).toEqual({ outcome: "completed" })
		const after = await state(doc.id, version.id)
		expect(after.version).toMatchObject({ imagesDone: true, text: TEXT })
		expect(after.version!.html).toContain(`src="/assets/${assetId}"`)
		expect(after.version!.html).toContain('data-original-src="https://img.example/a.png"')
		expect(after.doc!.leadImageAssetId).toBe(assetId)
		expect(notify).toHaveBeenCalledWith({ userId, documentId: doc.id, kind: "images" })
	})

	it("skips a version superseded before it starts, without fetching anything", async () => {
		const { doc, version } = await article()
		await addVersion(doc.id, 2)
		const { ingestImage } = delayedIngest()
		const outcome = await handleImages({ data: { versionId: version.id } }, { ingestImage })
		expect(outcome).toEqual({ outcome: "skipped", reason: "superseded" })
		expect(ingestImage).not.toHaveBeenCalled()
		expect(notify).not.toHaveBeenCalled()
	})

	it.each([
		[
			"a new version arrives",
			"superseded",
			async (documentId: string): Promise<void> => {
				await addVersion(documentId, 2)
			},
		],
		[
			"the article is trashed",
			"trashed",
			async (documentId: string): Promise<void> => {
				await db
					.update(documents)
					.set({ deletedAt: new Date() })
					.where(eq(documents.id, documentId))
			},
		],
		[
			"the article is deleted",
			"missing",
			async (documentId: string): Promise<void> => {
				await db.delete(documents).where(eq(documents.id, documentId))
			},
		],
	] as const)("publishes nothing when %s during the downloads", async (_, reason, change) => {
		const { doc, version } = await article()
		const { ingestImage, started, release } = delayedIngest()
		const running = handleImages({ data: { versionId: version.id } }, { ingestImage })
		await started
		await change(doc.id)
		release()
		expect(await running).toEqual({ outcome: "skipped", reason })
		const after = await state(doc.id, version.id)
		if (after.version) expect(after.version).toMatchObject({ html: HTML, imagesDone: false })
		if (after.doc) expect(after.doc.leadImageAssetId).toBeNull()
		expect(notify).not.toHaveBeenCalled()
	})

	it("lets one of two concurrent jobs publish; the other finds the work done", async () => {
		const { version } = await article()
		const first = delayedIngest()
		const second = delayedIngest()
		const jobs = [first, second].map(({ ingestImage }) =>
			handleImages({ data: { versionId: version.id } }, { ingestImage }),
		)
		await Promise.all([first.started, second.started])
		first.release()
		second.release()
		const outcomes = await Promise.all(jobs)
		expect(outcomes.filter((o) => o.outcome === "completed")).toHaveLength(1)
		expect(outcomes).toContainEqual({ outcome: "skipped", reason: "already_done" })
		expect(notify).toHaveBeenCalledTimes(1)
	})

	it("keeps the html when a rewrite would change the canonical text", async () => {
		const { doc, version } = await article()
		await db
			.update(documentVersions)
			.set({ text: "Different canonical text" })
			.where(eq(documentVersions.id, version.id))
		const { ingestImage, release } = delayedIngest()
		release()
		await handleImages({ data: { versionId: version.id } }, { ingestImage })
		const after = await state(doc.id, version.id)
		expect(after.version).toMatchObject({ html: HTML, text: "Different canonical text" })
	})
})
