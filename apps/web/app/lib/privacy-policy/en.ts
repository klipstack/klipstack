import { CONTROLLER, type Policy, PRIVACY_CONTACT } from "./types"

export default {
	title: "Privacy policy",
	updated: "Last updated October 17, 2026",
	summary:
		"Klipstack keeps what you save so you can read it. It doesn't sell your data, show ads or track you. This page explains what we collect, why, who helps us run the service, and what you can do about it.",
	contentsLabel: "On this page",
	email: PRIVACY_CONTACT,
	links: {
		"Anthropic's commercial terms": "https://www.anthropic.com/legal/commercial-terms",
		"TypeSafe's customer agreement": "https://typesafe.ai/legal/mca",
	},
	sections: [
		{
			id: "who",
			title: "Who we are",
			blocks: [
				`Klipstack is owned and operated by ${CONTROLLER} ("we"), a company in Chile. We decide how your data is used, and we answer for it.`,
				`Questions, requests or complaints: ${PRIVACY_CONTACT}.`,
			],
		},
		{
			id: "collect",
			title: "What we collect",
			blocks: [
				{
					list: [
						"Your account: name, email address, and your password as a one-way hash, never the password itself. Your language and reading settings.",
						"If you sign in with Google or GitHub: the name, email address and profile picture they send us. We don't keep their access tokens.",
						"What you save: each link, the page's text and images, a copy of the page as it was saved, and the time you saved it.",
						"What you add: highlights, notes, tags, saved searches, the feeds you follow, your reading progress and what you finished.",
						"If you ask about what you read (Explain, Define, Ask, Chat, Brief): the passage, your questions, the answers and the brief.",
						"Sign-ins: for each device you're signed in on, its IP address and the browser's description of itself (user agent). We keep them with the sign-in, to protect your account. A sign-in ends 30 days after you last use it.",
						"If you ask for an invite: your email address, the note you write, and your language. Only the people who run Klipstack see them.",
						"If you report a public page: the reason, what you write, your email address if you give one, and your language. Only the people who run Klipstack see them. The page's author never sees your report or your address.",
						"Abuse limits: for sign-in attempts, invite requests and reports, a scrambled (hashed) form of the IP address and email address. We delete these within about a day.",
						"Server logs: which page was asked for, the result and how long it took. They don't include your IP address or your account. Logs about saving can name an article's number or a website's name.",
						"Monthly counts for each account: how many articles you saved, editions you published, highlights you shared and questions you asked, how many articles were sorted into topics and how often AI proposed or reviewed your topics, how often a limit stopped something you did, what the AI behind questions and topics cost us, and how often you used parts of topics (such as filtering by a topic or renaming one). They're numbers only, with no articles, titles or topic names. Only the people who run Klipstack see them, to apply limits and decide what to improve.",
					],
				},
				"We don't use analytics services, ads, trackers, third-party scripts, third-party fonts or error-reporting services.",
			],
		},
		{
			id: "use",
			title: "How we use it",
			blocks: [
				{
					list: [
						"To run Klipstack: save, clean up, store, show and search what you save.",
						"To send account emails: sign-in links, address checks and password resets. We don't send newsletters or marketing.",
						"To answer a request for an invite. We email you only if we send you one.",
						"To decide on a report about a public page, and to email you the decision if you gave an address. If we take a page down, we tell its author why, without saying who reported it.",
						"To keep the service secure and stop abuse.",
						"To answer questions about what you read and write an article's brief, when you ask. See “Questions about what you read” below.",
						"To fix problems.",
					],
				},
				"We don't sell your data. We don't use it for ads, and we don't train AI models on it.",
				"The people who run Klipstack can reach the database to operate it. We look at your content only to fix a problem you report, to keep the service secure, or when the law requires it.",
			],
		},
		{
			id: "fetching",
			title: "When Klipstack fetches pages for you",
			blocks: [
				{
					list: [
						"When you save a link, our server downloads the page and its images. The website sees our server, not you.",
						"The browser extension sends the page as your browser shows it, including pages behind a login or a paywall. Save private pages with care: what the extension sends is stored in your library.",
						"Our server checks the feeds you follow for new posts, and reads a page's title and summary to preview a link. Previews are kept for 15 minutes, in memory only.",
						"To save a post from X (Twitter), our server asks FxTwitter for the post, using its address.",
						"Some pictures in lists load straight from the original website. Your browser asks for them without saying which page you came from.",
					],
				},
			],
		},
		{
			id: "providers",
			title: "Who else handles your data",
			blocks: [
				"A few companies help us run Klipstack. They handle your data only to provide their service to us.",
				{
					list: [
						"Hetzner Online hosts our servers and the database.",
						"Cloudflare stores the images from pages you save, and our encrypted database backups (R2).",
						"Resend sends our emails. It receives your email address and the message.",
						"Better Stack checks from outside that Klipstack is up. It sees no account data.",
						"Google or GitHub, only if you choose to sign in with them.",
						"FxTwitter, only when you save a post from X.",
						"Anthropic answers questions about what you read and writes briefs, only when you ask, and names your topics, only if you turn topics on.",
						"TypeSafe sorts your articles into topics, only if you turn topics on.",
					],
				},
				"We don't share your data with anyone else, unless the law requires it. If that happens, we tell you, unless the law forbids it.",
			],
		},
		{
			id: "ai",
			title: "Questions about what you read",
			blocks: [
				"In the reader, on the web or in the iPhone app, you can ask about a passage (explain it, define a word, or ask a question), chat about the whole article, or ask for its brief (Sum Up in the iPhone app): a short account of what it says and how it is built. Only then, our server sends Anthropic the article's text and what you asked: the passage, your question and, when you ask more, the earlier questions and answers. Then it shows you the answer. Apart from topics, below, nothing is sent unless you ask.",
				"Anthropic uses them only to answer, under Anthropic's commercial terms, and doesn't train its models on them.",
				"We keep your questions and the answers with the article, so you can read them again, until you delete them or the article, and its brief until you delete the article. Our server logs record that a question was answered and its size, never what it said.",
			],
		},
		{
			id: "topics",
			title: "Automatic topics",
			blocks: [
				"Topics are off until you turn them on, on the Topics page. While they are on, our server sends each article you save to TypeSafe, which sorts it into your topics: its title, site, description and the start of its text. It also sends Anthropic the titles, sites and descriptions of your articles (for one without a description, the first lines of its text), to propose your topics, grow new ones and review them.",
				"Under TypeSafe's customer agreement, TypeSafe uses what we send to sort it and doesn't train its models on it; it may keep it to watch for abuse and to meet legal obligations. Anthropic works under Anthropic's commercial terms, as for questions.",
				"We keep your topics and which articles are in them until you turn topics off, which deletes them, or delete your account.",
			],
		},
		{
			id: "cookies",
			title: "Cookies and storage on your device",
			blocks: [
				"Every cookie we set is needed for Klipstack to work or to remember your settings. None are for ads or tracking, so there is no cookie banner.",
				{
					list: [
						"klip.session_token keeps you signed in, for up to 30 days.",
						"klip.state protects a Google or GitHub sign-in, for 5 minutes.",
						"lng keeps your language, for a year.",
						"klip_tz, klip_layout, klip_sidebar and klip_hl_view keep your time zone and how you like lists shown, for a year. Signing out removes the last three.",
					],
				},
				"Your browser also keeps copies of your recent articles so they open offline. Signing out deletes them.",
			],
		},
		{
			id: "apps",
			title: "Apps, the extension and AI assistants",
			blocks: [
				{
					list: [
						"The browser extension acts only when you click it or use its menu, and only on that tab: it has no lasting access to the sites you visit. It sends the page you save, with its address and title, to the Klipstack server set in its options (klipstack.com unless you change it) and nowhere else. It removes scripts and hidden form fields first. For an article, it also downloads the page again, as your browser, and sends that copy too, because some sites cut the article in the browser. Saving a link from its menu sends only the link. It keeps the server's address in your browser's settings, which your browser may sync. It reaches a server other than klipstack.com only after you allow it.",
						"The iPhone app, in testing, keeps your sign-in in the iPhone's Keychain, shared with its share extension and widget, and keeps copies of articles so they open offline. It reads aloud on the phone itself: the text never leaves it. Its voice files download once, from Hugging Face and GitHub. When you dictate a note, the iPhone recognizes your speech on the device, with Apple's speech recognition: what you say never leaves the phone, and only the note's text reaches Klipstack. Look Up opens the iPhone's own dictionary. It reads the clipboard only when you tap Paste. It has no analytics and no crash reports.",
						"In the iPhone app, the AI in the reader works as on the web, and sends the same things: see “Questions about what you read”.",
						"The share extension (Klipstack in the iPhone's share sheet) reads only the link you share, or the first web link in shared text, and sends that link to Klipstack, which saves it as any other link.",
						"The Next up widget asks Klipstack for the next articles in your Inbox: title, site, reading time, how far you read and the picture. It keeps the latest on the phone to show offline. A picture Klipstack didn't store loads from the article's website.",
						"You can connect other apps and AI assistants to your library (API keys, MCP). They can reach only what you allow, and you can remove them in Settings at any time. What they do with the data is up to them and their own privacy policies.",
					],
				},
			],
		},
		{
			id: "retention",
			title: "How long we keep it",
			blocks: [
				{
					list: [
						"Your library stays as long as your account does.",
						"Things in the trash are deleted after 30 days. Saves that failed are deleted 7 days after you move them to the trash.",
						"A request for an invite is deleted when we answer it, with an invite or without one. If we send you an invite, the invite keeps your email address.",
						"A report, with your address, is deleted when we decide on it. The record of the decision keeps no part of the report.",
						"When you delete your account, we delete your data and images at once. Encrypted backups keep a copy for up to 30 days, then it is gone. The server also keeps its own backups for 3 days.",
						"Server logs are overwritten as they grow, and start over with each update.",
						"Monthly counts stay as long as your account does.",
						"Records of administrative actions keep no content. When you delete your account, they no longer point to you, and they are deleted after 90 days.",
					],
				},
			],
		},
		{
			id: "rights",
			title: "Your choices and rights",
			blocks: [
				{
					list: [
						"Get a copy: export your whole library, with highlights and notes, as Markdown and JSON from Settings. Your feeds export as OPML.",
						`Correct it: change your name in Settings. To change your email address, write to ${PRIVACY_CONTACT}.`,
						"Delete it: delete your account in Settings, or in Account in the iPhone app.",
						`Anything else, such as asking what we hold about you or objecting to a use: write to ${PRIVACY_CONTACT}. We answer within 30 days.`,
					],
				},
				"You can also complain to the data protection authority where you live.",
			],
		},
		{
			id: "security",
			title: "How we protect it",
			blocks: [
				"All traffic is encrypted (HTTPS). Passwords and API keys are stored only as hashes. Images from your saved pages are private and reach only your account. Backups are encrypted, and the key to read them is kept offline. Only the people who run Klipstack can reach the servers.",
				"No system is perfectly secure. If a breach puts your data at risk, we will tell you and the authorities, as the law requires.",
			],
		},
		{
			id: "children",
			title: "Children",
			blocks: [
				"Klipstack is not meant for anyone under 16. We don't knowingly collect their data.",
			],
		},
		{
			id: "changes",
			title: "Changes to this policy",
			blocks: [
				"When this policy changes, we update the date at the top. If a change affects how we use your data, we email you before it applies.",
			],
		},
	],
} satisfies Policy
