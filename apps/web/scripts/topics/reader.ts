import { z } from "zod"

/**
 * The simulated reader: another model than the ones it corrects, asked what a person browsing
 * their library would do. It judges an article against the topics as a reader sees them (name and
 * description, never the boundary), and now and then renames or removes a topic.
 */

const SYSTEM =
	"You are a person who saves articles to read in a reading app. The app sorts your library into topics: shelves you browse to find articles again. You see each topic's name and description. When an article sits on a shelf where you would not look for it, you take it out; now and then you rename a topic or remove one you do not want."

/**
 * How picky the reader is: `lenient` looks for an article wherever it fits; `strict` keeps shelves
 * narrow, as a reader does who corrects the topics often.
 */
export type Taste = "lenient" | "strict"

const TASTE: Record<Taste, string> = {
	lenient: "",
	strict:
		" You keep your shelves narrow: an article belongs on a shelf only when the shelf's subject is what the article is mainly about, not when it touches it or would fit a wider reading of the shelf.",
}

const system = (taste: Taste) => `${SYSTEM}${TASTE[taste]}`

export interface ReaderTopic {
	ref: string
	name: string
	description: string
}

const topicList = (topics: ReaderTopic[]) =>
	topics.map((t) => `- ${t.ref}: ${t.name}: ${t.description}`).join("\n")

/** Which topics the reader would look for an article on. */
export function judgeRequest(
	article: { title: string; siteName: string | null; description: string | null; text: string },
	topics: ReaderTopic[],
	taste: Taste = "lenient",
) {
	return {
		system: system(taste),
		prompt: `Your library's topics:\n${topicList(topics)}\n\nAn article in your library:\n<article>\nTitle: ${article.title}${article.siteName ? `\nSite: ${article.siteName}` : ""}${article.description ? `\nDescription: ${article.description}` : ""}\n\n${article.text.slice(0, 1500)}\n</article>\n\nOn which of these topics would you look for this article, and be glad to find it there? List only those; an article may belong on none of them.`,
		schema: z.object({
			topicIds: z.array(z.string()).describe("The topics, by id"),
		}),
	}
}

/** Whether the reader renames or removes a topic, looking at the list of them. */
export function tidyRequest(
	topics: (ReaderTopic & { articles: number; titles: string[] })[],
	confirming: boolean,
	taste: Taste = "lenient",
) {
	return {
		system: system(taste),
		prompt: `${confirming ? "The app proposes these first topics for your library" : "Your library's topics"}, with how many articles each holds and some of their titles:\n\n${topics
			.map(
				(t) =>
					`${t.ref}: ${t.name} (${t.articles} articles): ${t.description}\n${t.titles.map((title) => `    - ${title}`).join("\n")}`,
			)
			.join(
				"\n\n",
			)}\n\nWould you change one of them? Remove a topic you would never browse, or rename one whose name does not say what it holds to the name you would look for. Most of the time you change nothing. At most one change.`,
		schema: z.object({
			change: z.object({
				op: z.enum(["none", "rename", "remove"]),
				topicId: z.string().describe("The topic changed, by id; empty for none"),
				name: z.string().describe("rename: the new name; empty otherwise"),
			}),
		}),
	}
}
