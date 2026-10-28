/**
 * Pages that bot walls send in place of the page asked for, by who sends them. Each test matches
 * the wall's own page only: real pages load some of these services too (a reCAPTCHA comment form,
 * Cloudflare's background script, DataDome's tag, Incapsula's script), and must not match.
 */
const WALLS: ReadonlyArray<readonly [name: string, page: RegExp]> = [
	// Google's, which PubMed sends: a 200.
	[
		"recaptcha",
		/<base href="https:\/\/www\.google\.com\/recaptcha\/challengepage\/|RecaptchaChallengePageUi/,
	],
	["cloudflare", /window\._cf_chl_opt|<title>Just a moment\.\.\.<\/title>/],
	[
		"anubis",
		/<script id="anubis_challenge"|<title>Making sure you(?:'|&#39;)re not a bot!<\/title>/,
	],
	["datadome", /captcha-delivery\.com/],
	["perimeterx", /id="px-captcha"|<title>Access to this page has been denied/],
	// AWS WAF's challenge comes as a 202.
	["aws-waf", /window\.gokuProps\s*=/],
	["vercel", /<title>Vercel Security Checkpoint<\/title>/],
	["sucuri", /<title>Sucuri WebSite Firewall/],
	["incapsula", /Incapsula incident ID/],
	["akamai", /errors(?:\.|&#46;)edgesuite(?:\.|&#46;)net/],
]

/** The wall a page comes from, when it is a bot check rather than the page asked for. */
export function botCheck(html: string): string | null {
	for (const [name, page] of WALLS) if (page.test(html)) return name
	return null
}
