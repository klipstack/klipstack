/** The reader's AI in the iPhone app: Explain, Define, Ask, the chat and the brief. */
export default {
	actions: {
		explain: "Explain",
		define: "Define",
		ask: "Ask",
		chat: "Chat",
		/** Checks a passage's claim against the web. */
		check: "Fact check",
		/** Asking about a passage, before choosing how. */
		askAi: "Ask AI",
	},
	card: {
		/** The passage asked about, quoted. */
		passage: "“{{exact}}”",
		thinking: "Thinking…",
		/** A fact check's web search, while it runs. */
		searching: "Searching: {{query}}",
		/** Under a fact check. */
		checkNotice:
			"Fact checks search the web through Anthropic and can be wrong. Open the sources to judge them.",
		askPlaceholder: "Ask about this passage…",
		followUpPlaceholder: "Ask a follow-up…",
		send: "Send",
		answerAgain: "Answer Again",
		copy: "Copy",
		failed: "Couldn't answer. Try again.",
		refused: "This question couldn't be answered.",
		suggestions: {
			example: "Give me an example",
			matters: "Why does it matter?",
			evidence: "What is the evidence?",
		},
	},
	answer: {
		/** A citation's number, for VoiceOver. */
		citation: "Passage {{n}} of the article",
		/** A web page a fact check cites, for VoiceOver: its site. */
		source: "Source: {{site}}",
	},
	chat: {
		title: "Chat",
		empty: "Ask anything about this article. Answers cite the parts they use.",
		placeholder: "Ask about this article…",
		clear: "Clear Chat",
		turnedOff: "AI answers are turned off in Settings → Features, on the web.",
	},
	brief: {
		title: "Brief",
		/** Above the article's title, in capitals. */
		sumUp: "SUM UP",
		writing: "Writing the brief…",
		failed: "Couldn't write the brief. Try again.",
		/** The brief's section headings, which the server writes in English. */
		sections: { claims: "Key claims", caveats: "Keep in mind", parts: "Parts" },
	},
	consent: {
		title: "Ask Anthropic's AI?",
		sent: "To answer, Klipstack sends Anthropic the article's text and what you ask about it: the passage you chose, your question. Anthropic uses them only to answer, and doesn't train its models on them.",
		when: "Nothing is sent until you ask. Your choice holds in the app on all your devices, and you can change it in Account.",
		privacy: "Privacy Policy",
		failed: "Couldn't save your choice. Nothing was sent. Try again.",
		continue: "Continue",
		notNow: "Not Now",
	},
	left_one: "{{count}} question left this month",
	left_other: "{{count}} questions left this month",
	errors: {
		limitReached: "You've asked as many questions as this month allows. It starts over on the 1st.",
		limitReachedOn:
			"You've asked as many questions as this month allows. It starts over on {{date}}.",
		rateLimited: "Too many questions at once. Wait a few minutes and try again.",
		network: "Klipstack couldn't be reached. Check your connection and try again.",
		noMatch: "That passage isn't in the article anymore.",
		ambiguousQuote: "That passage appears more than once. Select a little more of it.",
		notReady: "The article is being updated. Try again in a moment.",
		forbidden: "AI answers aren't turned on for your account.",
		unavailable: "AI answers aren't set up on this server.",
		tooLarge: "This article is too long to ask about.",
		alreadyPending: "The last question is still being answered. Try again in a minute.",
		factCheckLimit: "You've used this month's fact checks. They start over on the 1st.",
		factCheckLimitOn: "You've used this month's fact checks. They start over on {{date}}.",
		other: "Couldn't answer. Try again.",
	},
}
