/** Home, its cards and sheets (saving a link, Discover, the review of old saves). */
export default {
	/** The masthead: the greeting, what was finished this past week and the next edition. */
	masthead: {
		greeting: {
			morning: "Good morning",
			afternoon: "Good afternoon",
			evening: "Good evening",
		},
		finished_one: "You finished {{count}} article this past week.",
		finished_other: "You finished {{count}} articles this past week.",
		finishedUntitled: "You finished an article this past week.",
		/** Around the title of the one article finished, which Home sets apart. */
		finishedBefore: "You finished ",
		finishedAfter: " this past week.",
		nextEdition: "Your next edition: ",
		draft_one: "{{count}} article in the draft",
		draft_other: "{{count}} articles in the draft",
		draftEmpty: "a draft started",
		marked_one: "{{count}} marked",
		marked_other: "{{count}} marked",
		continueEditing: "Continue editing",
		putTogether: "Put it together",
		notNow: "Not now",
		/** Why an edition is due. */
		nudge: {
			draft: "You started it {{ago}}. Ready to publish it?",
			last: "Your last edition came out {{ago}}.",
			marked_one: "{{count}} article is marked for the next one.",
			marked_other: "{{count}} articles are marked for the next one.",
			read_one: "You finished {{count}} article since.",
			read_other: "You finished {{count}} articles since.",
		},
		ago: {
			today: "today",
			yesterday: "yesterday",
			days_one: "{{count}} day ago",
			days_other: "{{count}} days ago",
			weeks_one: "{{count}} week ago",
			weeks_other: "{{count}} weeks ago",
		},
	},
	/** "How much time do you have?" */
	time: {
		title: "How much time do you have?",
		any: "Any",
		anyLength: "Any length",
		choice: "{{minutes}} min",
		minutes_one: "{{count}} minute",
		minutes_other: "{{count}} minutes",
		pickUp_one: "Doesn't fit in {{count}} minute, but it's where you left off.",
		pickUp_other: "Doesn't fit in {{count}} minutes, but it's where you left off.",
		nothingFits_one: "Nothing in your library fits in {{count}} minute.",
		nothingFits_other: "Nothing in your library fits in {{count}} minutes.",
		nothingFitsTopic_one: "Nothing in {{topic}} fits in {{count}} minute.",
		nothingFitsTopic_other: "Nothing in {{topic}} fits in {{count}} minutes.",
		showAll: "Show everything",
	},
	/** "About what?": the reader's topics. */
	topics: {
		title: "About what?",
		any: "Anything",
		different: "Something different",
		more: "More",
		moreLabel: "More topics",
		timed_one: "{{count}} minute of {{topic}}",
		timed_other: "{{count}} minutes of {{topic}}",
		toRead_one: "{{count}} to read",
		toRead_other: "{{count}} to read",
		differentNever: "Something different: a topic you haven't read from yet.",
		differentLeast: "Something different: the topic you haven't read from in the longest time.",
		all: "Everything in {{topic}}",
		nothing: "Nothing in {{topic}} to read right now.",
	},
	sections: {
		continueReading: "Continue reading",
		upNext: "Up next",
		minutesLeft_one: "{{count}} min left",
		minutesLeft_other: "{{count}} min left",
		recent: "Recently saved",
		again: {
			title: "Read again",
			note: "Articles you finished and put back, to read once more.",
		},
		highlights: {
			title: "From your highlights",
			note: "Passages you marked, back for another look. A few each day.",
		},
		rediscover: {
			title: "From a while ago",
			note_one: "Saved more than {{count}} day ago. A different few each day.",
			note_other: "Saved more than {{count}} days ago. A different few each day.",
		},
		quick: {
			title: "A few minutes to read",
			note: "Ten minutes or less.",
		},
	},
	empty: {
		title: "Your next read starts here",
		description:
			"Share an article to Klipstack from Safari or any app, or tap + to paste a link. It will be here when you're ready to read.",
	},
	/** A toast's words when an answer here was not saved. */
	saveFailed: "Couldn't save that. Try again.",
	highlights: {
		deleteFailed: "Couldn't delete it. Try again.",
		dismissed: "It won't come back here. The highlight stays.",
	},
	/** Finished lately without a note. */
	notes: {
		title: "Anything to keep from these?",
		description:
			"You finished these without a note. A line on what you take from each helps it stay with you. Nothing to add is fine too.",
		openHint: "Opens it with its notes, to write one",
		write: "Write a note",
		readAgain: "Read again",
		readAgainLabel: "Read {{title}} again",
		skip: "Nothing to add",
		skipLabel: "Nothing to add on {{title}}",
		thisArticle: "this article",
		skipped: "It won't be asked about again.",
		putBack: "It's back in your library, under Read again.",
		notNow: "Not now",
		finished: {
			today: "Finished today",
			yesterday: "Finished yesterday",
			days_one: "Finished {{count}} day ago",
			days_other: "Finished {{count}} days ago",
		},
		listened: {
			today: "Listened to today",
			yesterday: "Listened to yesterday",
			days_one: "Listened to {{count}} day ago",
			days_other: "Listened to {{count}} days ago",
		},
	},
	/** Home's word about topics: the invitation, or the first topics ready. */
	topicsCard: {
		invitationTitle: "Your library is big enough to sort itself",
		invitationBody:
			"You've saved {{number}} articles: enough for topics to sort them into shelves, like a bookstore's sections, and keep them sorted as you save more.",
		privacy: "Once you turn topics on, article text is sent to TypeSafe and Anthropic.",
		seeTopics: "See Topics",
		decline: "No thanks",
		readyTitle: "Your first topics are ready",
		readyBody: "Klipstack found topics in your library. Look them over and confirm them.",
		seeYourTopics: "See Your Topics",
		notNow: "Not now",
	},
	/** Saving a link: the + sheet, and a link copied elsewhere offered on Home. */
	save: {
		linkLabel: "Link to save",
		saving: "Saving…",
		saved: "Saved to Klipstack",
		already: "Already in Klipstack",
		notALink: "That isn't a web address.",
		nothingToPaste: "There's nothing to paste.",
	},
	clipboard: {
		copied: "You copied a link",
		pasteHere: "Paste it here to save it.",
		noLink: "The clipboard holds no link.",
		dismiss: "Dismiss",
	},
	/** The starter texts: Home's offer when it has nothing to read, and Discover. */
	starter: {
		description:
			"Essays, stories and speeches to try highlights and notes on. A book marked with a site is saved from the site that publishes it. Choose a book to add it to your library.",
		topics: {
			reading: { title: "Reading & writing", description: "Writers on books, style and readers." },
			stories: { title: "Stories", description: "Short fiction to read in one sitting." },
			living: { title: "How to live", description: "Advice on time, work and character." },
			ideas: {
				title: "Ideas & work",
				description: "Essays on making things, technology and thinking for yourself.",
			},
			science: {
				title: "Science & nature",
				description: "Scientists and naturalists explaining the world.",
			},
			society: {
				title: "Society & history",
				description: "Speeches and essays that argued for change.",
			},
		},
		minutes: "{{minutes}} min",
		openLabel: "Open {{title}}",
		addLabel: "Add {{title}} to your library",
		addFromLabel: "Add {{title}} to your library from {{site}}",
		notAdded: "Not added",
		offline: "Can't reach Klipstack. Connect to the internet to add it.",
		guide: {
			saved: "In your library",
			new: "New to Klipstack?",
			line: "Saving, highlighting and notes, in {{minutes}} min.",
			open: "Open",
			read: "Read it",
		},
		offerTitle: "Or start with one of these",
		more: "More to read",
	},
	discover: {
		language: "Language",
		languageMenu: "Language of the texts",
		languageLabel: "Language of the texts: {{language}}",
	},
	/** The review of old saves: Home's card and its screen. */
	review: {
		card: {
			title: "Still want to read these?",
			description:
				"Some articles you saved more than a month ago haven't been opened. Keep the ones you still want and archive the rest. Archived articles stay in your archive and in search.",
			open: "Go Through Them",
			notNow: "Not now",
		},
		title: "Old Saves",
		notYet: "Your Klipstack server doesn't have this yet.",
		allMenu: "All of them",
		archiveNext: "Archive the Next {{count}}",
		archiveAll: "Archive All {{count}}",
		keepNext: "Keep the Next {{count}}",
		keepAll: "Keep All {{count}}",
		intro:
			"Saved more than {{after}} ago, never opened. Archived articles stay in your archive and in search. Kept ones won't come back here for {{keep}}.",
		keep: "Keep",
		left_one: "{{count}} left",
		left_other: "{{count}} left",
		leftMore_one: "{{count}}+ left",
		leftMore_other: "{{count}}+ left",
		savedAgain: "Saved again since, so it stays in the trash.",
		undoFailed: "Couldn't undo it: it's been too long, or you're offline.",
		failed: "Nothing changed. Try again.",
		empty: {
			title: "Nothing left to go through",
			description: "You've decided on every save from long ago.",
		},
		/** The toast once the server answered. */
		done: {
			keep_one: "Kept",
			keep_other: "{{count}} articles kept",
			archive_one: "Archived",
			archive_other: "{{count}} articles archived",
			delete_one: "Deleted",
			delete_other: "{{count}} articles deleted",
		},
		/** The server's days, as in "Saved more than a month ago". */
		span: {
			days_one: "{{count}} day",
			days_other: "{{count}} days",
			month: "a month",
			months_one: "{{count}} month",
			months_other: "{{count}} months",
		},
		savedAgo: {
			days_one: "Saved {{count}} day ago",
			days_other: "Saved {{count}} days ago",
			weeks_one: "Saved {{count}} week ago",
			weeks_other: "Saved {{count}} weeks ago",
			months_one: "Saved {{count}} month ago",
			months_other: "Saved {{count}} months ago",
			year: "Saved a year ago",
			years_one: "Saved {{count}} year ago",
			years_other: "Saved {{count}} years ago",
		},
		/** The card: a tap opens it; VoiceOver's actions. */
		openHint: "Opens it to read. Swipe right to keep it, left to archive it.",
	},
	/** Offline reading. */
	offline: {
		note: "Can't reach Klipstack. Articles kept on this phone still open.",
		notKept: "This article isn't on this phone yet. Connect to the internet to read it.",
	},
	/** The Topics screen's words (src/lib/topic-shelves.ts). */
	topicShelves: {
		untitled: "Untitled",
		articles_one: "{{count}} article",
		articles_other: "{{count}} articles",
		waiting: {
			title: "Keep reading",
			body: "Your first topics come when you have saved {{needed}} articles: {{count}} of {{needed}} so far.",
		},
		proposing: {
			title: "Proposing your first topics…",
			body: "This takes a minute or so. The screen updates on its own.",
		},
		articlesWaiting_one: "{{count}} article is waiting",
		articlesWaiting_other: "{{count}} articles are waiting",
		sortsOff: "This server sorts no articles into topics: {{waiting}}.",
		/** Starts with a space: it follows "Sorting stopped for this month:". */
		sorted: " {{max}} articles were sorted, the most an account can.",
		paused:
			"Sorting stopped for this month:{{sorted}} {{waiting}}, and sorting starts again on {{date}}. Nothing is lost.",
		libraryPaused:
			"Sorting your library paused for this month, so new saves can still be sorted. {{waiting}}, and sorting starts again on {{date}}. Nothing is lost.",
		sorting_one: "Sorting your library into its topics: {{count}} article to go.",
		sorting_other: "Sorting your library into its topics: {{count}} articles to go.",
		empty: "No topics right now. New ones appear as you save more articles.",
		turnOff: "This deletes your topics and where each article was. It can't be undone.",
		turnOffSaved_one:
			"{{count}} saved search names topics and will find nothing in them: {{names}}.",
		turnOffSaved_other:
			"{{count}} saved searches name topics and will find nothing in them: {{names}}.",
		quoted: "“{{name}}”",
		refusal: {
			nameTaken: "Another topic has that name.",
			invalidName: "A topic name has 1 to 60 characters.",
			notFound: "That topic is gone.",
			alreadyDone: "Your topics are confirmed already.",
			forbidden: "Topics are not turned on for your account.",
			unavailable: "Topics are not set up on this server.",
		},
	},
}
