/**
 * Pages that bot walls send in place of the page asked for, by who sends them: every pattern of a
 * wall must match, and each wall has one that matches a tag, never text: an article, a comment or
 * a code sample that names a wall's address or script has its `<` escaped. Titles are matched
 * whole. No pattern may backtrack: they run on what any site sends (`[^<>]*`, not `[^>]*`). Real pages load some of these services too (a
 * reCAPTCHA comment form, Cloudflare's background script, DataDome's tag, Incapsula's script), and
 * must not match.
 */
const WALLS: ReadonlyArray<readonly [name: string, patterns: readonly RegExp[]]> = [
	// Google's, which PubMed sends: a 200.
	[
		"recaptcha",
		[
			/<base href="https:\/\/www\.google\.com\/recaptcha\/challengepage\/|<title>Checking your browser - reCAPTCHA<\/title>/,
		],
	],
	["cloudflare", [/<title>(?:Just a moment\.\.\.|Attention Required! \| Cloudflare)<\/title>/]],
	[
		"anubis",
		[/<script id="anubis_challenge"|<title>Making sure you(?:'|&#39;)re not a bot!<\/title>/],
	],
	["datadome", [/<(?:script|iframe)\b[^<>]*\bsrc="https:\/\/(?:ct|geo)\.captcha-delivery\.com\//]],
	["perimeterx", [/<div id="px-captcha"|<title>Access to this page has been denied\.?<\/title>/]],
	// AWS WAF's challenge comes as a 202, its CAPTCHA as a 405.
	["aws-waf", [/<div id="(?:challenge|captcha)-container"/, /window\.gokuProps\s*=/]],
	["vercel", [/<title>Vercel Security Checkpoint<\/title>/]],
	["sucuri", [/<title>Sucuri WebSite Firewall - (?:CloudProxy - )?Access Denied<\/title>/i]],
	["incapsula", [/<iframe\b[^<>]*\bsrc="\/_Incapsula_Resource\?/]],
	["akamai", [/<title>Access Denied<\/title>/i, /errors(?:\.|&#46;)edgesuite(?:\.|&#46;)net/]],
]

/** The wall a page comes from, when it is a bot check rather than the page asked for. */
export function botCheck(html: string): string | null {
	for (const [name, patterns] of WALLS) if (patterns.every((p) => p.test(html))) return name
	return null
}
