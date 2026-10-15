export default {
	appName: "Klipstack",
	home: {
		headline: "Read more of what interests you. <mark>Keep what matters.</mark>",
		description:
			"Klipstack is a read-later app for curious people. It helps you choose what to read next, gives you a calm page to read it on, and <strong>makes it easy to pause at the end and keep what stayed with you</strong>.",
		login: "Log in",
		openApp: "Open Klipstack",
		signup: "Sign up",
		requestInvite: "Request an invite",
		hero: {
			eyebrow: "A read-later app",
			eyebrowInvite: "A read-later app · Invite only, for now",
			emailLabel: "Email address",
			admission: "Klipstack lets people in a few at a time.",
			private: "Your library is private. You share only what you choose to publish.",
		},
		journey: {
			label: "One article, start to finish",
			eyebrow: "One article, start to finish",
			title: "Follow one article through Klipstack.",
			description:
				"The examples below work like the app, with a sample essay. Try them: nothing you do here is saved or published.",
			steps: {
				choose: "Choose your next read",
				read: "Enjoy reading",
				capture: "Capture what stayed with you",
				keep: "Revisit it or share it",
			},
		},
		choose: {
			eyebrow: "Step 1 · Choose",
			title: "Find something you want to read now.",
			body: "Home starts with a simple question: how much time do you have? Pick fifteen minutes and you see what fits, counting only the minutes left in articles you've started.",
			more: "Pick up where you left off, see what you saved lately, and meet a few older saves you may have forgotten, a different few each day. Follow a site's feed, and its new posts wait beside your library until you decide to save one.",
			source:
				"Everything here comes from what you saved and the sites you follow. No trending lists, no sponsored picks.",
			demoLabel: "A sample of Klipstack's home",
			readIt: "Read it",
			items: {
				walk: { site: "field-notes.example", title: "The slow pleasures of a long walk" },
				essay: { site: "essays.example", title: "What we keep from what we read" },
				benches: { site: "streets.example", title: "Why cities need more benches" },
				bread: { site: "kitchen-notes.example", title: "How bread taught me patience" },
				cards: { site: "paper-trails.example", title: "A short history of the index card" },
			},
		},
		read: {
			eyebrow: "Step 2 · Read",
			title: "Enjoy reading it.",
			body: "Klipstack keeps a clean copy of each article: no ads or pop-ups, in the font and size you like, light or dark. It remembers where you stopped, and unread articles are ready offline.",
			more: "Highlight the lines you want to remember and write in the margin. Highlights are private: marking a line never shares it.",
		},
		demo: {
			label: "A sample article you can highlight",
			hint: "Tap a sentence to highlight it. Tap a highlight to remove it.",
			clear: "Clear",
			site: "essays.example",
			title: "What we keep from what we read",
			sentences: {
				s1: "Most of what we read is gone within a week.",
				s2: "The article was good, and we nodded along.",
				s3: "Then the next tab opened, and it slid under everything that came after.",
				s4: "Readers solved this long ago, with a pencil.",
				s5: "A marked sentence is a note to your future self.",
				s6: "A line in the margin starts a conversation you can pick up years later.",
				s7: "None of it takes long: a minute at the end, before the next thing.",
				s8: "What you write there is the part of the article that becomes yours.",
			},
			marginNote: "This is why I highlight at all.",
		},
		capture: {
			eyebrow: "Step 3 · Capture",
			title: "What stayed with you?",
			prompt: "A thought, a question, or something you want to try.",
			body: "When you reach the end, Klipstack leaves room for a moment before the next thing: a note on the article, for you alone. Write it in your own words, and link another article you saved if this one reminded you of it.",
			optional:
				"Write a line or skip it. Leave without a note and the article is still finished and filed in your archive, highlights and all, once you've reached the end. You can add a note whenever you come back.",
			edition:
				"If it's worth passing on, mark it for your next edition. You get a second, separate note for your readers, which can start from your private one and be polished later.",
			demoLabel: "The end of the sample article",
			demoHint: "Write a line, or don't. Both are fine.",
			next: "See where it ends up",
		},
		keep: {
			eyebrow: "Step 4 · Revisit or share",
			title: "A library that's yours. Share when you want to.",
			body: "Your highlights and notes collect in your notebook, by article, and search covers them along with every word you saved. Each day, Home brings back a few highlights from a while back, for another look.",
			demoLabel: "Where the sample article ends up",
			notebook: {
				title: "Notebook",
				onlyYou: "Only you",
				empty: "Highlights and notes you make above show up here.",
				highlights_one: "{{count}} highlight",
				highlights_other: "{{count}} highlights",
			},
			edition: {
				eyebrow: "Editions",
				title: "What did you read this week?",
				body: "An edition is a shareable collection of good reads, with your thoughts attached. Gather the articles you marked, choose a few highlights to quote, add a line or two, and publish one link. It sends readers to the original articles; it doesn't republish them.",
				private:
					"Your library is private. An edition goes public only when you publish it, shows only what you chose, and asks search engines to skip it. Editions are in beta.",
				notIn: "Not in an edition",
				notInBody:
					"The article stays in your library, private. Mark it for your next edition to see how one would look.",
				draft: "Draft · not published",
				kicker: "An edition",
				name: "What I read this week",
				quoteHint: "Choose up to {{count}} highlights to quote.",
				noHighlights: "No highlights to quote. The link and your note are enough.",
				publishNote: "Nobody sees this until you publish it from the edition's page.",
			},
		},
		phone: {
			eyebrow: "Coming soon · iPhone",
			title: "Klipstack is coming to your iPhone.",
			body: "The iPhone app is built and in testing now, on its way to the App Store. It brings the same reading with you: Home's next reads, the clean reader, your highlights, and the note at the end of every article.",
			account:
				"One account, one library: what you save on your phone is waiting on your computer, and the other way around.",
			save: {
				title: "Save from any app",
				description:
					"Share a link from Safari, or any app with a share button, and it goes straight to your library.",
			},
			listen: {
				title: "Listen when you can't read",
				description:
					"Klipstack reads articles aloud, in English or Spanish, marking each sentence as it goes. The voice runs on your phone, so after a one-time download it works offline too.",
			},
			widget: {
				title: "Your next read, on your home screen",
				description: "A widget shows what's next, one tap away from reading it.",
			},
			shotAlt:
				"The Klipstack iPhone app reading an article aloud, with the sentence it is reading highlighted.",
			caption: "Reading aloud, in the iPhone app.",
		},
		basics: {
			eyebrow: "The basics",
			title: "A good read-later app, first of all.",
			save: {
				title: "Save from anywhere",
				description:
					"Paste a link, use the browser extension for Chrome and Firefox, or follow a site's feed. The extension saves the page as you see it, even behind a login.",
			},
			read: {
				title: "Read your way",
				description:
					"Serif, sans or a font for dyslexic readers, three widths, light or dark. Unread and starred articles stay on your device for reading offline.",
			},
			find: {
				title: "Find it again",
				description:
					"Search every word you saved, your highlights and notes too. Tag what you like and keep the searches you repeat in the sidebar.",
			},
		},
		maker: {
			eyebrow: "Who makes it",
			title: "Made by one reader.",
			body: "Hi, I'm Ernesto. I built Klipstack for my own reading. I wanted an easier way to choose the next thing to read, a calm page to read it on, and a reason to stop for a minute at the end and write down what I took from it, before moving on.",
			more: "Now I'm opening it to other people who might like reading this way. I build and run it myself, so invites go out a few at a time, as there's room.",
			signature: "Ernesto",
		},
		commitments: {
			eyebrow: "Your reading, your terms",
			title: "Private by default. Easy to leave.",
			intro:
				"Pocket closed in July 2025 and Omnivore in November 2024, and their readers had to move years of reading on someone else's deadline. Klipstack makes leaving easy instead of asking you to trust that it lasts forever.",
			private: {
				title: "Private unless you publish.",
				description:
					"Your library, highlights and notes are yours alone. Only an edition you publish is public, and only what you put in it.",
			},
			ads: {
				title: "No ads. No trackers.",
				description:
					"Klipstack never shows ads or sells what you read, and it uses no analytics services.",
			},
			export: {
				title: "Export everything, any time.",
				description:
					"One download from Settings: a Markdown file for every article with its highlights and notes, plus a JSON bundle of it all.",
			},
			delete: {
				title: "Delete means deleted.",
				description:
					"Deleted articles wait 30 days in the trash, then they're gone. Delete your account and everything goes with it, editions included; backups age out within 30 days.",
			},
			copy: {
				title: "Your copy outlives the link.",
				description:
					"Klipstack keeps a clean copy of each article and its images, so it stays readable when the original changes or disappears.",
			},
			source: {
				title: "Open source.",
				description:
					"The code is public under the AGPL, and there's a guide to running your own copy with Docker if you'd rather host it yourself.",
			},
			privacy: "Read the privacy policy",
			code: "See the code",
			selfHost: "Host it yourself",
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
					"One person builds and runs Klipstack. Every new reader adds storage and server work, so people come in a few at a time, by email invite, as there's room.",
			},
			note: {
				question: "Do I have to write something after every article?",
				answer:
					"No. The note at the end is an invitation, not a step. Read to the end and close it, and it's finished, with or without a note. Plenty of articles don't need one.",
			},
			notes: {
				question: "Is my note what an edition shows?",
				answer:
					"No. Your note on an article is private. Marking an article for an edition gives you a separate note for your readers, which you can start from your private one. An edition shows your private note only if you choose to include it.",
			},
			quotes: {
				question: "How much of an article can an edition quote?",
				answer:
					"Up to three highlights per article, and no more than a tenth of its words, 150 at most. An edition points to good writing; it can't rebuild the piece.",
			},
			import: {
				question: "Can I import from Pocket or Omnivore?",
				answer:
					"Not yet. There's no importer for Pocket, Omnivore, Instapaper or Readwise today, so keep your export file. You can save links one at a time and bring your feeds over with OPML.",
			},
			apps: {
				question: "Is there an app?",
				answer:
					"Klipstack runs in the browser on your computer and your phone, and unread and starred articles stay available offline. An iPhone app is in testing; it saves from the share sheet and reads articles aloud. There's no Android app.",
			},
			extension: {
				question: "Is there a browser extension?",
				answer:
					"Yes, for Chrome and Firefox. It isn't in the browser stores yet, so for now you build it from the source code and load it yourself. Settings links to it.",
			},
			search: {
				question: "How do I find things later?",
				answer:
					"Search covers every saved word, your highlights and your notes. Narrow it with filters such as tag:, site: or before:, keep the searches you repeat, and press ⌘K (Ctrl K) to jump anywhere.",
			},
			ai: {
				question: "Does Klipstack use AI?",
				answer:
					"Reading, notes and editions don't need it. Some readers are trying optional features in beta: asking about a passage as you read, a short brief of an article, and sorting the library into topics. You can also connect an assistant such as Claude to search your library, decide whether it may also make changes, such as saving, tagging and writing notes, and disconnect it any time.",
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
				"Leave your email, and a line about what you like to read if you want. When there's room, you'll get one email with your invite. It may take a while: people come in a few at a time.",
			privacy: "Your email is used for the invite and nothing else. No newsletter, no marketing.",
			signupTitle: "Start reading.",
			signupDescription: "Have an invite code? Create your account.",
			openDescription: "Create your account and save your first article.",
		},
		/** The link-preview image and the X header (scripts/icons.ts), and their description. */
		shareCard: {
			/** The reader's note on the post-it, beside the sample essay's highlighted sentence. */
			note: "One line of my own, before the next tab.",
			alt: "{{appName}}, a read-later app: {{headline}} Beside it, an article with a highlighted sentence and a reader's note on a post-it.",
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
	shortcuts: {
		title: "Keyboard shortcuts",
		show: "Keyboard shortcuts",
		off: "Single-key shortcuts are off.",
		turnOn: "Turn them on",
		groups: {
			general: "Everywhere",
			lists: "In lists",
			reader: "In the reader",
		},
		rows: {
			palette: "Command palette: search, go to, act",
			submit: "Done, in a text field",
			listMove: "Next or previous article",
			listArrows: "Move between the cards",
			listOpen: "Open the article",
			star: "Star",
			shortlist: "Add to the next edition",
			archive: "Archive",
			unread: "Mark as unread",
			tags: "Tags",
			delete: "Delete",
			select: "Select the article",
			selectRange: "Select while moving",
			selectAll: "Select all",
			clear: "Clear the selection",
			search: "Search",
			paragraph: "Next or previous paragraph",
			askParagraph: "Ask the AI about the paragraph",
			stops: "Previous or next AI answer or note",
			brief: "Show the brief",
			focus: "Focus mode: dim all but the paragraph",
			leave: "Stop reading by paragraph",
			sidebar: "Notes and highlights",
			chat: "Chat about the article",
			articleActions: "Star, next edition, archive, unread, tags, delete",
			copyHighlight: "Copy the highlight in focus",
			help: "This list",
		},
	},
}
