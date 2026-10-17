import { CONTROLLER, type Policy, SUPPORT_CONTACT } from "../privacy-policy/types"

export default {
	title: "Terms of use",
	updated: "Last updated October 17, 2026",
	summary:
		"These are the rules for using Klipstack. In short: what you save is yours and stays private, what you publish must be legal and fair to others, every account has limits, and we can take down what breaks these rules.",
	contentsLabel: "On this page",
	email: SUPPORT_CONTACT,
	sections: [
		{
			id: "service",
			title: "The service",
			blocks: [
				`Klipstack lets you save web pages, read them, highlight them and take notes. You can also publish editions, public pages of what you read, and share highlights at public links. It is owned and operated by ${CONTROLLER} ("we"), a company in Chile.`,
				// TODO: pricing is not decided. Add payment, renewal and refund terms before charging anyone.
				"Klipstack is young. It is free for now, it may change, and it may have bugs. If we ever stop it, we will tell you at least 30 days before, so you can download your library.",
				`Questions about these terms: ${SUPPORT_CONTACT}.`,
			],
		},
		{
			id: "account",
			title: "Your account",
			blocks: [
				{
					list: [
						"You must be 16 or older.",
						"One person per account. Keep your sign-in safe; what happens in your account is your responsibility.",
						"Use an email address you can read: we send sign-in links and important notices there.",
					],
				},
			],
		},
		{
			id: "content",
			title: "What you save",
			blocks: [
				"What you save, highlight and write stays yours. You let us store and process it only to run Klipstack for you. Your library is private: only you see it.",
				"Saving a page keeps a personal copy for your reading. Respect the rights of the sites you save: don't republish their content through Klipstack.",
			],
		},
		{
			id: "editions",
			title: "Public editions and shared highlights",
			blocks: [
				"An edition you publish, or a highlight you share at a link, can be read by anyone with its link. You let us show it to them. It links to the articles and may quote short passages; it never republishes them.",
				"An edition or a shared highlight must not contain:",
				{
					list: [
						"Anything illegal, or links to it.",
						"Spam, scams or misleading content.",
						"Someone else's work without their permission, beyond short quotes.",
						"Harassment, threats or hate against people or groups.",
						"Malware, phishing, or links to them.",
						"Other people's personal data without their consent.",
					],
				},
			],
		},
		{
			id: "limits",
			title: "Limits",
			blocks: [
				"Every account has limits: articles saved a month, storage, feeds followed, editions published and highlights shared a month. Settings shows yours and how much you use. There are also limits on how fast you can save or call the API.",
				"We may change the limits. Don't get around them, for example with several accounts or scripts.",
			],
		},
		{
			id: "use",
			title: "Fair use",
			blocks: [
				{
					list: [
						"Don't use Klipstack to break the law or to harm others.",
						"Don't attack, overload or probe Klipstack, and don't try to reach other people's data.",
						"Don't resell Klipstack or use it to fetch pages for others at scale.",
					],
				},
			],
		},
		{
			id: "reports",
			title: "Reports and removals",
			blocks: [
				'Anyone can report a public edition with "Report this page". A person reads every report; a report alone takes nothing down.',
				"If an edition breaks these terms, we may remove it. We email you why. A removed edition cannot be published again unless we restore it.",
				`If you think we made a mistake, write to ${SUPPORT_CONTACT}. We will look again.`,
				"For serious or repeated breaches, we may close the account. When it is reasonable, we warn you first.",
			],
		},
		{
			id: "ending",
			title: "Leaving",
			blocks: [
				"You can download your library and delete your account at any time, in Settings. Deleting it deletes your data, as the privacy policy explains.",
			],
		},
		{
			id: "liability",
			title: "No guarantees",
			blocks: [
				"We work to keep Klipstack running and your data safe, but we offer it as it is, without guarantees. Keep your own copy of what matters: Settings lets you download everything.",
				"As far as the law allows, we are not liable for indirect losses, or for losses from a service you get for free. Nothing in these terms limits the rights consumer law gives you.",
			],
		},
		{
			id: "changes",
			title: "Changes to these terms",
			blocks: [
				"When these terms change, we update the date at the top. For an important change, we email you before it applies. If you keep using Klipstack after that, the new terms apply.",
			],
		},
		{
			id: "law",
			title: "Law",
			blocks: [
				"Chilean law applies to these terms. Disputes go to the courts of Chile, unless consumer law gives you the right to go elsewhere.",
			],
		},
	],
} satisfies Policy
