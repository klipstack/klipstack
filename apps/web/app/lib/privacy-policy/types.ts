/** A paragraph, or a bulleted list. */
export type PolicyBlock = string | { list: string[] }

export type Policy = {
	title: string
	/** When the text last changed, written out in the policy's language. */
	updated: string
	summary: string
	contentsLabel: string
	/** Linked wherever the text names it. */
	email: string
	/** Phrases linked wherever the text names them, to the page each names (a provider's terms). */
	links?: Record<string, string>
	sections: Array<{ id: string; title: string; blocks: PolicyBlock[] }>
}

export { LEGAL_NAME as CONTROLLER, PRIVACY_CONTACT, SUPPORT_CONTACT } from "../company"
