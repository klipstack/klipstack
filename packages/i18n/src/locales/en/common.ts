export default {
	appName: "Klipstack",
	home: {
		headline: "What did you <mark>read</mark> <em>this week?</em>",
		description:
			"Klipstack saves the articles you want to read and gives you a quiet place to read them. Your highlights and notes stay with them, linked to each other.",
		login: "Log in",
		openApp: "Open Klipstack",
		signup: "Sign up",
		inviteOnly: "Invite only, for now.",
		requestInvite: "Request an invite",
		hero: {
			eyebrow: "A read-later app · Invite only, for now",
			emailLabel: "Email address",
			admission: "Klipstack lets people in a few at a time.",
			haveCode: "Have an invite code?",
			lede: "When a week of reading is worth passing on, publish it as an edition.",
		},
		try: {
			eyebrow: "Try it",
			title: "Mark what matters.",
			description:
				"This is how an article reads in Klipstack. Highlight a sentence, and it turns up in the sample edition below.",
		},
		demo: {
			label: "A sample article you can highlight",
			hint: "This works like an article in Klipstack. Tap a sentence to highlight it. Tap a highlight to remove it.",
			clear: "Clear",
			site: "essays.example",
			readingTime: "3 min read",
			title: "What we keep from what we read",
			sentences: {
				s1: "Most of what we read is gone within a week.",
				s2: "The article was good, and we nodded along.",
				s3: "Then it slid under everything that came after.",
				s4: "Readers solved this long ago, with a pencil.",
				s5: "A marked sentence is a note to your future self.",
				s6: "Write a line beside it and you start a conversation you can pick up years later.",
				s7: "Klipstack does the same for what you read on a screen.",
				s8: "It keeps every mark you make next to the words you made it on.",
			},
			marginNote: "This is why I highlight at all.",
			articleNote: "Pairs with",
			linkedTitle: "The case for rereading",
			backlinks: "Linked from 2 articles",
		},
		edition: {
			eyebrow: "Editions",
			title: "Pass on a week of reading.",
			description:
				"An edition is a page of what you read in a week or a month: the links, a short intro, and the few highlights and notes you choose to share. It sends readers to the original articles and never republishes them.",
			tryIt:
				"The highlights you made above are already in this one. Mark more and watch the limit: an edition quotes a tenth of an article at most, never more than 150 words, so it can't rebuild the piece.",
			private:
				"Nothing is public until you publish it. The link is unlisted and asks search engines to skip it. Editions are in beta.",
			previewLabel: "A sample edition with your highlights",
			kicker: "An edition",
			name: "Week 40, 2026",
			intro: "One essay this week, and it was enough.",
			empty: "Highlight a sentence above and it appears here.",
			counter: "{{count}} / {{max}} words quoted",
			over: "Left out: over the limit",
		},
		steps: {
			eyebrow: "How it works",
			title: "Save, read, mark. Publish if you want.",
			save: {
				title: "Save",
				description:
					"Paste a link, follow a site's feed, or use the browser extension for Chrome and Firefox. The extension saves the page as you see it, even behind a login.",
			},
			read: {
				title: "Read",
				description:
					"A clean page in the font and size you like, light or dark. Klipstack keeps your place and keeps unread articles ready offline.",
			},
			mark: {
				title: "Mark",
				description:
					"Highlight and write in the margin. Type [[ in a note to link another article. Links between saved articles connect on their own.",
			},
			publish: {
				title: "Publish, if you want",
				description:
					"Pick a week, a month or any dates, choose what goes on the page, and share one link. Or keep it all to yourself.",
			},
			find: {
				title: "Find it again",
				description:
					"Search every word you saved, your notes too. Filter with tag:, pin the searches you repeat, and jump anywhere with ⌘K.",
			},
			ask: {
				title: "Ask as you read",
				badge: "Beta",
				description:
					"Select a word or a passage to have it explained, defined or answered in the margin, citing the paragraphs it draws on. Or read a brief of the article and chat about it.",
			},
			assistant: {
				title: "Bring your assistant",
				badge: "Beta",
				description:
					"Connect Claude or another MCP client to search and read your library. You decide whether it may also save and tag, and you can disconnect it in Settings.",
			},
			phone: {
				title: "On your phone",
				badge: "Coming soon",
				description:
					"Klipstack works in your phone's browser, offline too. An iPhone app is coming.",
			},
		},
		commitments: {
			eyebrow: "Commitments",
			title: "Built so you can leave.",
			intro:
				"Pocket closed in July 2025. Omnivore closed in November 2024. Their readers had to move years of reading on someone else's deadline. Klipstack is new and small, so it makes leaving easy instead of asking you to trust that it lasts forever.",
			private: {
				title: "No ads. No tracking.",
				description:
					"Klipstack never shows ads or sells what you read. No analytics follow you around.",
			},
			export: {
				title: "Export everything, any time.",
				description:
					"One download from Settings: a Markdown file for every article with its highlights, plus a JSON bundle of it all.",
			},
			delete: {
				title: "Delete means deleted.",
				description:
					"Deleted articles wait 30 days in the trash, then they're gone. Delete your account and everything goes with it, editions included.",
			},
			source: {
				title: "Editions link to the source.",
				description:
					"An edition shows titles, your chosen quotes and your notes, and sends readers to the original site.",
			},
			copy: {
				title: "Your copy outlives the link.",
				description:
					"Klipstack keeps a clean copy of each article and its images, so it stays readable when the original changes or disappears.",
			},
			assistant: {
				title: "Your assistant, on your terms.",
				description:
					"An AI assistant gets in only after you approve it. You choose whether it can change anything, and you can cut it off.",
			},
			privacy: "Read the privacy policy",
		},
		faq: {
			eyebrow: "Questions",
			title: "Straight answers.",
			free: {
				question: "Is it free?",
				answer:
					"Today there's nothing to pay and no card to enter. Pricing isn't decided yet. When it is, it will be on this page before anyone is asked to pay.",
			},
			invite: {
				question: "Why is it invite-only?",
				answer:
					"One person builds and runs Klipstack. Every new reader adds storage and server work, so people come in a few at a time. Request an invite and you'll get an email when there's room.",
			},
			import: {
				question: "Can I import from Pocket or Omnivore?",
				answer:
					"Not yet. There's no importer for Pocket, Omnivore, Instapaper or Readwise today, so keep your export file. You can save links one at a time and bring your feeds over with OPML.",
			},
			apps: {
				question: "Is there an app?",
				answer:
					"Klipstack runs in the browser on your computer and your phone, and unread and starred articles stay available offline. An iPhone app is coming. There's no Android app.",
			},
			extension: {
				question: "Is there a browser extension?",
				answer:
					"Yes, for Chrome and Firefox. It isn't in the browser stores yet: once you're in, you install it from Settings.",
			},
			privacy: {
				question: "Who can see what I read?",
				answer:
					"Only you. Your library, tags, highlights and notes are private. An edition goes public only when you publish it, and it shows only what you chose.",
			},
		},
		invite: {
			eyebrow: "Invite only, for now",
			title: "Request an invite.",
			description:
				"Leave your email and you'll get an invite when there's room. Invites go out a few at a time, so the app stays quick.",
			privacy: "Your email is used for the invite and nothing else. No newsletter.",
			signupTitle: "Start reading.",
			signupDescription: "Have an invite code? Create your account.",
		},
		footer: {
			label: "Site",
			terms: "Terms",
			privacy: "Privacy",
			support: "Support",
			copyright: "© {{year}} {{company}}",
		},
	},
	support: {
		title: "Support",
		description: "Help with Klipstack: write to us, manage your data, or delete your account.",
		contact: {
			title: "Write to us",
			body: "For questions, problems or feedback, email",
			tips: "Say what you tried, what happened, and on which device. If it's about an article, include its link.",
		},
		account: {
			title: "Your account and data",
			export:
				"Download your whole library, with highlights and notes, in Settings, under Your data.",
			delete:
				"Delete your account in Settings, under Delete account. It deletes your articles, highlights, notes and images.",
			privacy: "The privacy policy explains what we keep and why.",
			privacyRequest: "For a request about your data, write to",
		},
		report: {
			title: "Report a public page",
			body: 'Every public edition has a "Report this page" link at the bottom.',
		},
		company: "Klipstack is owned and operated by {{company}}, a company in Chile.",
	},
	actions: {
		save: "Save",
		cancel: "Cancel",
		delete: "Delete",
		back: "Back",
		close: "Close",
		select: "Select",
		done: "Done",
	},
	nav: {
		home: "Home",
		library: "Library",
		inbox: "Library",
		feed: "Feed",
		feedNew: "New posts",
		editionDue: "Your next edition is waiting",
		topics: "Topics",
		topicsReady: "Your first topics are ready",
		archive: "Archive",
		starred: "Starred",
		highlights: "Highlights",
		notebook: "Notebook",
		editions: "Editions",
		trash: "Trash",
		settings: "Settings",
		admin: "Admin",
		logout: "Log out",
		account: "Account: {{name}}",
		collapse: "Collapse sidebar",
		expand: "Expand sidebar",
		resize: "Resize sidebar",
		tags: "Tags",
		search: "Search",
		tagCount: "{{count}} articles",
		tagCount_one: "{{count}} article",
		tagCount_other: "{{count}} articles",
		menu: "Menu",
		add: "Add",
	},
	savedSearches: {
		heading: "Saved searches",
		save: "Save search",
		saved: "Saved",
		savedAs: "Saved as “{{name}}”",
		saveCommand: "Save this search",
		saveTitle: "Save search",
		renameTitle: "Rename saved search",
		nameLabel: "Name",
		rename: "Rename",
		more: "More for “{{name}}”",
		deleted: "Deleted “{{name}}”",
		topicEnded: "The topic “{{name}}” ended",
		undo: "Undo",
		errors: {
			invalid_name: "A name has 1 to 50 characters.",
			invalid_query: "This search is too long to save.",
			name_taken: "Another saved search has that name.",
			too_many: "You have 50 saved searches. Delete one to save another.",
			generic: "The search could not be saved.",
		},
	},
	errors: {
		generic: "Something went wrong.",
		notFound: "Page not found.",
		notFoundDetail: "The page you are looking for does not exist.",
		gone: "Page removed.",
		goneDetail: "Its author took this page down.",
		goneRemoved: "Klipstack took this page down because it broke the rules.",
		unexpected: "An unexpected error occurred.",
		offline: "You are offline.",
		offlineDetail:
			"This page is not saved for offline reading. Articles in your library and starred list are.",
		invalidForm: "Please check the form for errors.",
	},
	language: {
		label: "Language",
		en: "English",
		es: "Spanish",
	},
	palette: {
		label: "Command palette",
		placeholder: "Search or type a command…",
		empty: "No results.",
		actions: "Actions",
		results: "Articles",
		highlights: "Highlights",
		notes: "Notes",
		navigate: "Go to",
		search: "Search",
		article: "This article",
		selected: "Selected article",
		saveClipboard: "Save link from clipboard",
		clipboardEmpty: "No link in the clipboard.",
		theme: "Theme: {{theme}}",
		showSidebar: "Show notes and highlights",
		hideSidebar: "Hide notes and highlights",
		copyLink: "Copy original link",
		searchFor: "Search articles for “{{q}}”",
		copied: "Link copied",
	},
	theme: {
		label: "Theme",
		system: "System",
		light: "Light",
		dark: "Dark",
	},
}
