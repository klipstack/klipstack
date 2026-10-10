import { hash } from "./cache"

const DAY = 86_400_000
/** Editorial hints select actual sentences; quoted text is never invented. */
const curation = [
	{
		match: "paulgraham.com/makersschedule",
		tags: ["work"],
		hint: /^A single meeting/i,
		highlightNote: "Block two uninterrupted mornings next week.",
		note: "Try grouping meetings into two afternoons. Protect the other mornings for work that needs a longer stretch of attention.",
		related: "thoughtbot.com/blog/wip-is-waste",
	},
	{
		match: "thoughtbot.com/blog/wip-is-waste",
		tags: ["work"],
		hint: /work in progress|finish|batch/i,
		note: "Check the number of things we have started before we take on another project.",
		related: "paulgraham.com/makersschedule",
	},
	{
		match: "geoffreylitt.com",
		tags: ["technology"],
		hint: /end.user|software|custom/i,
		note: "Keep this for the next discussion about tools people can adapt to their own work.",
	},
	{
		match: "nesslabs.com/learning-in-public",
		tags: ["learning", "writing"],
		hint: /public|learn|share/i,
		note: "Try a short weekly learning note. Start with one thing I understood better this week.",
		related: "registerspill.thorstenball.com/p/be-findable",
	},
	{
		match: "registerspill.thorstenball.com/p/be-findable",
		tags: ["writing", "work"],
		hint: /You don’t really find an audience/i,
		highlightNote: "Publish the small experiments, too.",
		note: "Make the small experiments easier to find. A finished personal site is not a prerequisite for publishing a useful note.",
		related: "nesslabs.com/learning-in-public",
	},
	{
		match: "waitbutwhy.com/2015/12/the-tail-end",
		tags: ["life"],
		hint: /time|parents|friend/i,
		note: "Plan the next family visit before filling the calendar with smaller commitments.",
		related: "oliveremberton.com/2014/if-you-want-to-follow",
	},
	{
		match: "oliveremberton.com/2014/if-you-want-to-follow",
		tags: ["life", "work"],
		hint: /^If you want the power to follow your dreams/i,
		note: "Use this as a prompt for the monthly review: what am I willing to stop doing?",
		related: "waitbutwhy.com/2015/12/the-tail-end",
	},
	{
		match: "staysaasy.com",
		tags: ["work"],
		hint: /^If you’re managing a high performer/i,
		highlightNote: "Specific feedback matters even when things are going well.",
		note: "Revisit before the next round of one-to-ones. Ask what would make the work more challenging and worthwhile.",
	},
	{
		match: "perell.com/essay/the-ultimate-guide-to-writing-online",
		tags: ["writing"],
		hint: /^Writing from Conversation is/i,
		highlightNote: "Use the next conversation to test the main point of the draft.",
		note: "Come back to the practical exercises when I have a draft to work with.",
		reading: true,
		related: "nesslabs.com/learning-in-public",
	},
	{
		match: "moretothat.com/the-antidote-to-envy",
		tags: ["life"],
		hint: /envy|compar|desire/i,
		note: "A useful topic for the journal: which comparisons actually help me decide what I want?",
	},
	{
		match: "benkuhn.net/paradoxes",
		tags: ["learning"],
		hint: /learn|know|belie/i,
		note: "Keep the examples together and revisit them after trying to explain the argument in my own words.",
	},
	{
		match: "collabfund.com/blog/its-supposed-to-be-hard",
		tags: ["work", "life"],
		hint: /hard|difficult|expect/i,
		note: "Remember this when estimating the effort for a new project. Leave room for the difficult middle.",
	},
] as const

export const searches = [
	{ name: "A short reading break", query: "in:library is:quick" },
	{ name: "Worth revisiting", query: "in:archive is:starred" },
	{ name: "Writing notebook", query: "tag:writing has:note" },
]
export function fraction(seed: string, url: string, purpose: string): number {
	return Number.parseInt(hash(`${seed}\0${url}\0${purpose}`).slice(0, 8), 16) / 0x1_0000_0000
}
export type ReadingState = "unread" | "progress" | "finished" | "abandoned" | "trash"
export function articlePlan(
	url: string,
	title: string,
	seed: string,
	date: string,
	fromFeed = false,
) {
	const curated = curation.find((item) => url.includes(item.match))
	const r = fraction(seed, url, "state")
	const discarded = /makeuseof\.com|wellnessmama\.com/.test(url)
	const state: ReadingState = fromFeed
		? "unread"
		: discarded
			? "trash"
			: curated
				? "reading" in curated
					? "progress"
					: "finished"
				: r < 0.48
					? "unread"
					: r < 0.64
						? "progress"
						: r < 0.91
							? "finished"
							: r < 0.96
								? "abandoned"
								: "trash"
	const base = Date.parse(date)
	const age = fromFeed
		? 0.1 + fraction(seed, url, "age") * 0.5
		: state === "unread"
			? 0.1 + fraction(seed, url, "age") * 35
			: 7 + fraction(seed, url, "age") * 110
	const createdAt = new Date(base - Math.round(age * DAY))
	const firstOpenedAt = state === "unread" ? null : new Date(+createdAt + DAY)
	const lastReadAt = firstOpenedAt
		? new Date(+firstOpenedAt + DAY * (1 + fraction(seed, url, "read-time") * 3))
		: null
	const archivedAt = state === "finished" || state === "abandoned" ? lastReadAt : null
	const readingProgress =
		state === "unread"
			? 0
			: state === "finished"
				? 1
				: 0.15 + Math.round(fraction(seed, url, "progress") * 60) / 100
	const starred =
		Boolean(curated) ||
		(state !== "trash" && state !== "unread" && fraction(seed, url, "star") < 0.17)
	const tags = curated ? [...curated.tags] : inferTags(`${url} ${title}`)
	return {
		state,
		tags,
		hint: curated?.hint,
		note: curated?.note ?? null,
		highlightNote: curated && "highlightNote" in curated ? curated.highlightNote : null,
		related: curated && "related" in curated ? curated.related : null,
		dates: {
			createdAt,
			updatedAt: lastReadAt ?? createdAt,
			firstOpenedAt,
			lastReadAt,
			archivedAt,
			readAt: state === "finished" ? lastReadAt : null,
			starredAt: starred ? lastReadAt : null,
			deletedAt: state === "trash" ? new Date(base - 2 * DAY) : null,
			readingProgress,
			readingPosition: readingProgress,
			noteUpdatedAt: curated ? lastReadAt : null,
		},
	}
}
function inferTags(text: string): string[] {
	if (/writ|publishing|stories|liberal.arts|novel|craft/i.test(text)) return ["writing"]
	if (/start.?up|manag|leadership|entrepreneur|product|work|autonomy/i.test(text)) return ["work"]
	if (/technology|software|llm|crypto|decentralized/i.test(text)) return ["technology"]
	if (/nautil|quanta|scientific|physics|consciousness|water.freezes|information/i.test(text))
		return ["science"]
	if (/learn|curiosity|ideas|paradox/i.test(text)) return ["learning"]
	return ["life"]
}
