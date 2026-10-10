/**
 * Real pages captured from the web. Each entry pins the URL the page was fetched from and a few
 * things the pipeline must get right: quotes that must survive into the canonical text, and a
 * lower bound on word count. Snapshot metadata (title, author, dates) lives next to the test.
 */
export interface Fixture {
	file: string
	url: string
	minWords: number
	quotes: string[]
	/** Substring expected in the extracted title (case-insensitive). */
	title?: string
	/** Page chrome (menus, footers) that must NOT survive extraction. */
	mustNotContain?: string[]
}

export const fixtures: Fixture[] = [
	{
		file: "theguardian-cancer.html",
		url: "https://www.theguardian.com/commentisfree/2020/sep/07/terminal-cancer-live-cancer-life-death",
		minWords: 900,
		quotes: ["I have come to see growing old as a privilege. Nobody should lament getting one year older, another grey hair or a wrinkle."],
	},
	{
		file: "nathanbarry-good-things.html",
		url: "https://nathanbarry.com/good-things/",
		minWords: 500,
		quotes: ["writing is how you get attention. And in todays world attention is the most valuable resource."],
	},
	{
		file: "waitbutwhy-tail-end.html",
		url: "https://waitbutwhy.com/2015/12/the-tail-end.html",
		minWords: 800,
		quotes: ["Living in the same place as the people you love matters."],
		title: "tail end",
	},
	{
		file: "collabfund-hard.html",
		url: "https://collabfund.com/blog/its-supposed-to-be-hard/",
		minWords: 400,
		quotes: [
			"The reason Warren Buffett is interesting is because there’s only one of him.",
			"every big comedian tests their material in small clubs before using it in big venues",
		],
	},
	{
		file: "staysaasy-high-performers.html",
		url: "https://staysaasy.com/startups/2024/05/08/managing-high-performers.html",
		minWords: 500,
		quotes: [
			"Weak managers let high performing reports do whatever they want. Even the best performers need structure and guidance - a coach.",
			"The single most important activity to do with your high performer is career planning.",
			"Even Tiger Woods has a coach, and he is definitely a better golfer than his own coach.",
		],
	},
	{
		file: "fullmoon-tal.html",
		url: "https://www.fullmoon.nu/articles/art.php?id=tal",
		minWords: 2000,
		quotes: ["I met god the other day.", "So figure it out for yourself"],
		mustNotContain: ["Harry's Blogspot", "Recent Changes", "T H E B O O K", "Police State of America"],
	},
	{
		file: "psyche-listening.html",
		url: "https://psyche.co/ideas/why-listening-well-can-make-disagreements-less-damaging",
		minWords: 800,
		quotes: ["listening"],
	},
	{
		file: "geoffreylitt-llm.html",
		url: "https://www.geoffreylitt.com/2023/03/25/llm-end-user-programming",
		minWords: 1500,
		quotes: ["end-user programming"],
	},
	{
		file: "readtheprofile-couples.html",
		url: "https://www.readtheprofile.com/p/100-couples-share-their-secrets-to",
		minWords: 1500,
		quotes: ["Do I want to be happy, or do I want to be right?", "Remember, you might “win” the argument, but you could lose the marriage."],
	},
	{
		file: "wikipedia-readability.html",
		url: "https://en.wikipedia.org/wiki/Readability",
		minWords: 1500,
		quotes: ["Readability is the ease with which a reader can understand a written text"],
		title: "Readability",
	},
	{
		file: "paulgraham-makers.html",
		url: "https://paulgraham.com/makersschedule.html",
		minWords: 800,
		quotes: ["There are two types of schedule"],
	},
	{
		file: "joelonsoftware-joel-test.html",
		url: "https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/",
		minWords: 1500,
		quotes: ["Do you use source control?", "Can you make a build in one step?"],
		title: "Joel Test",
	},
	{
		file: "overreacted-useeffect.html",
		url: "https://overreacted.io/a-complete-guide-to-useeffect/",
		minWords: 4000,
		quotes: ["Each Render Has Its Own Props and State", "useEffect"],
		title: "useEffect",
	},
	{
		file: "mdn-highlight-api.html",
		url: "https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API",
		minWords: 400,
		quotes: ["CSS Custom Highlight API"],
		title: "Custom Highlight",
	},
	{
		file: "kentcdodds-context.html",
		url: "https://kentcdodds.com/blog/how-to-use-react-context-effectively",
		minWords: 800,
		quotes: ["React Context"],
		title: "Context",
	},
	{
		file: "lenny-pmf.html",
		url: "https://www.lennysnewsletter.com/p/how-to-know-if-youve-got-productmarket",
		minWords: 1500,
		quotes: ["product-market fit"],
		title: "product-market fit",
	},
	{ file: "github-defuddle.html", url: "https://github.com/kepano/defuddle", minWords: 300, quotes: ["Defuddle"], title: "defuddle" },
	{
		file: "bbc-teens.html",
		url: "https://www.bbc.com/future/article/20220124-why-teens-arent-what-they-used-to-be",
		minWords: 1200,
		quotes: ["teenagers"],
		title: "teenagers",
	},
	{
		file: "aeon-friends.html",
		url: "https://aeon.co/essays/treasure-your-friends-the-top-of-your-love-hierarchy",
		minWords: 2500,
		quotes: ["friends"],
		title: "friends",
	},
	{
		file: "nautilus-bar.html",
		url: "https://nautil.us/a-scientist-walks-into-a-bar-583747/",
		minWords: 1000,
		quotes: ["laughter"],
	},
]
