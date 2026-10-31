import { db, documents, editions, eq } from "@klipstack/db"
import { deleteEdition, publishEdition } from "../../app/commands/editions.server"
import {
	addItem,
	createEdition,
	updateEdition,
	updateItem,
} from "../../app/services/editions.server"
import type { State } from "./local"

/**
 * An article in a demo edition, found by a part of its address. `quotes` picks its highlights in
 * the article's order, from 0; a quote's note is the edition's caption under it.
 */
interface PlannedItem {
	url: string
	note?: string
	quotes?: Array<number | { index: number; note: string }>
}

interface PlannedEdition {
	title: string
	intro: string
	publish: boolean
	items: PlannedItem[]
}

/**
 * Between them, every way an edition shows an article: a note with quotes under it, a short first
 * quote that stands out (with and without a caption), long quotes, a note alone, and neither.
 */
const plans: PlannedEdition[] = [
	{
		title: "On attention, and the work it takes",
		intro:
			"A few things I read this month about how we spend our hours, and what we get back for them.",
		publish: true,
		items: [
			{
				url: "paulgraham.com/makersschedule",
				note: "The clearest explanation I know of why one meeting in the afternoon can wreck a whole day of making. I sent it to my manager.",
				quotes: [0, { index: 2, note: "This is the part I keep coming back to." }, 3],
			},
			{ url: "the-most-precious-resource-is-agency", quotes: [2, 4] },
			{ url: "saving-the-liberal-arts", quotes: [3, 4] },
			{
				url: "solitude-and-leadership",
				note: "A lecture given to West Point cadets that reads like a letter to anyone who works on a screen. Thinking takes long stretches alone; the essay says why, better than I could.",
			},
			{
				url: "the-antidote-to-envy",
				note: "Short and kind.",
				quotes: [{ index: 2, note: "Worth reading twice." }],
			},
			{
				url: "thorstenball.com/p/be-findable",
				quotes: [{ index: 1, note: "Advice I needed ten years ago." }],
			},
			{ url: "nautil.us/what-is-time" },
		],
	},
	{
		title: "Working in the open",
		intro: "Still collecting. Not published yet.",
		publish: false,
		items: [
			{ url: "thoughtbot.com/blog/wip-is-waste", quotes: [1] },
			{
				url: "nathanbarry.com/good-things",
				note: "Why I started writing here at all.",
				quotes: [0, 1],
			},
			{ url: "nesslabs.com/learning-in-public", quotes: [2] },
		],
	},
]

/** The demo editions, once: an account that has any keeps them as they are. */
export async function seedEditions(state: State) {
	const existing = await db
		.select({ id: editions.id })
		.from(editions)
		.where(eq(editions.userId, state.userId))
		.limit(1)
	if (existing.length) return
	// A draft shortlists its articles and publishing takes them off, which would date them today;
	// the reading history dates them.
	const dated = await db
		.select({ id: documents.id, updatedAt: documents.updatedAt })
		.from(documents)
		.where(eq(documents.userId, state.userId))
	// A failure leaves no edition behind, so the next seed makes them again.
	const made: string[] = []
	try {
		for (const plan of plans) {
			const edition = await createEdition(state.userId, { locale: "en", timeZone: "UTC" })
			made.push(edition.id)
			await updateEdition(state.userId, edition.id, { title: plan.title, intro: plan.intro })
			for (const planned of plan.items) {
				// A page the capture missed, or a highlight the reading history did not make, is left
				// out: the edition shows fewer cases, and says so here.
				const url = Object.keys(state.documents).find((u) => u.includes(planned.url))
				if (!url) {
					console.log(`No demo article for the edition, left out: ${planned.url}`)
					continue
				}
				const item = await addItem(state.userId, edition.id, state.documents[url]!.id)
				const quotes = (planned.quotes ?? [])
					.map((q) => (typeof q === "number" ? { index: q } : q))
					.filter((q) => {
						if (q.index < item.highlights.length) return true
						console.log(`No highlight ${q.index} to quote, left out: ${planned.url}`)
						return false
					})
				await updateItem(state.userId, edition.id, item.id, {
					includeNote: planned.note !== undefined,
					note: planned.note ?? null,
					highlights: item.highlights.map((h, i) => {
						const quote = quotes.find((q) => q.index === i)
						return {
							highlightId: h.highlightId,
							included: quote !== undefined,
							note: quote && "note" in quote ? quote.note : null,
						}
					}),
				})
			}
			if (plan.publish) {
				const published = await publishEdition(state.userId, edition.id)
				if (!published.ok)
					throw new Error(`Cannot publish the demo edition: ${JSON.stringify(published.problems)}`)
			}
		}
	} catch (error) {
		for (const id of made) await deleteEdition(state.userId, id)
		throw error
	} finally {
		for (const doc of dated)
			await db.update(documents).set({ updatedAt: doc.updatedAt }).where(eq(documents.id, doc.id))
	}
}
