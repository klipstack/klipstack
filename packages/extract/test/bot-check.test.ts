import { describe, expect, it } from "vitest"
import { botCheck } from "../src/bot-check"

/** Trimmed copies of what each wall sends in place of the page: the parts that name it. */
const WALL_PAGES: Record<string, string> = {
	// pubmed.ncbi.nlm.nih.gov, 2026-10.
	recaptcha: `<!doctype html><html lang="en-US" dir="ltr"><head><base href="https://www.google.com/recaptcha/challengepage/"><link rel="preconnect" href="//www.gstatic.com"><meta name="referrer" content="origin"><script nonce="x">window['ppConfig'] = {productName: 'RecaptchaChallengePageUi'};</script><title>Checking your browser - reCAPTCHA</title></head><body></body></html>`,
	cloudflare: `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="refresh" content="390"></head><body><noscript>Enable JavaScript and cookies to continue</noscript><script>(function(){window._cf_chl_opt = {cvId: '3', cType: 'managed'};}());</script></body></html>`,
	anubis: `<!doctype html><html lang="en"><head><title>Making sure you&#39;re not a bot!</title></head><body><script id="anubis_version" type="application/json">"v1.21.3"</script><script id="anubis_challenge" type="application/json">{"rules":{"difficulty":4}}</script><p>Loading...</p></body></html>`,
	datadome: `<html><head><title>example.com</title></head><body style="margin:0"><script>var dd={'rt':'c','cid':'x','hsh':'y','t':'fe','host':'geo.captcha-delivery.com'}</script><script src="https://ct.captcha-delivery.com/c.js"></script></body></html>`,
	perimeterx: `<!DOCTYPE html><html lang="en"><head><title>Access to this page has been denied</title></head><body><div id="px-captcha"></div><script src="/xyz/captcha/captcha.js?a=c&m=0"></script></body></html>`,
	"aws-waf": `<!DOCTYPE html><html lang="en"><head><title></title></head><body><div id="challenge-container"></div><script>window.awsWafCookieDomainList = []; window.gokuProps = {"key":"x","iv":"y","context":"z"};</script><script src="https://abc.edge.sdk.awswaf.com/abc/def/challenge.js"></script></body></html>`,
	vercel: `<!DOCTYPE html><html lang="en"><head><title>Vercel Security Checkpoint</title></head><body><p>We're verifying your browser</p></body></html>`,
	sucuri: `<!DOCTYPE html><html><head><title>Sucuri WebSite Firewall - Access Denied</title></head><body><h2>Access Denied - Sucuri Website Firewall</h2></body></html>`,
	incapsula: `<html><head><META NAME="robots" CONTENT="noindex,nofollow"></head><body><iframe src="/_Incapsula_Resource?CWUDNSAI=1&xinfo=x">Request unsuccessful. Incapsula incident ID: 123000450012345678-90123456789012345</iframe></body></html>`,
	akamai: `<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\nYou don't have permission to access "http&#58;&#47;&#47;www&#46;example&#46;com&#47;" on this server.<P>\nReference&#32;&#35;18&#46;5e1c2c17&#46;1761600000&#46;1a2b3c4d\n<P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;5e1c2c17&#46;1761600000&#46;1a2b3c4d</P>\n</BODY>\n</HTML>`,
}

/** Real pages that load a wall's scripts, or talk about one: none of them is a wall. */
const PAGES: Record<string, string> = {
	"a comment form with reCAPTCHA": `<html><head><title>A post</title><script src="https://www.google.com/recaptcha/api.js" async defer></script></head><body><article><p>Text.</p><form><div class="g-recaptcha" data-sitekey="x"></div></form></article></body></html>`,
	"Cloudflare's background script": `<html><head><title>A post</title></head><body><article><p>Text.</p></article><script>(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.head.appendChild(a);})();</script></body></html>`,
	"a Turnstile form": `<html><head><title>Contact</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script></head><body><form><div class="cf-turnstile" data-sitekey="x"></div></form></body></html>`,
	"DataDome's tag": `<html><head><title>A shop</title><script src="https://js.datadome.co/tags.js" async></script></head><body><p>Products.</p></body></html>`,
	"AWS WAF's CAPTCHA integration": `<html><head><title>Sign up</title><script src="https://abc.token.awswaf.com/abc/def/jsapi.js" defer></script></head><body><form></form></body></html>`,
	"Incapsula's script": `<html><head><title>A bank</title></head><body><p>Welcome.</p><script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3"></script></body></html>`,
	"a review of a wall": `<html><head><title>Sucuri WebSite Firewall review</title></head><body><p>Text.</p></body></html>`,
	"a story about one": `<html><head><title>Access to this page has been denied: a story</title></head><body><p>Text.</p></body></html>`,
	"AWS WAF's challenge script": `<html><head><title>A shop</title><script src="https://abc.token.awswaf.com/abc/def/challenge.js" defer></script></head><body><p>Products.</p></body></html>`,
	"an article about walls": `<html><head><title>How bot walls work</title></head><body><article><p>Cloudflare shows a page titled "Just a moment..." and sets window._cf_chl_opt. Akamai answers "Access Denied" with a link to errors.edgesuite.net. DataDome loads geo.captcha-delivery.com, Incapsula says "Incapsula incident ID: 123-456", and Google's RecaptchaChallengePageUi says "Checking your browser".</p></article></body></html>`,
	"a code sample of wall pages": `<html><head><title>Scraping notes</title></head><body><pre><code>&lt;title&gt;Just a moment...&lt;/title&gt;
&lt;title&gt;Access Denied&lt;/title&gt; https://errors.edgesuite.net/18.1
&lt;div id="px-captcha"&gt;&lt;/div&gt;
&lt;div id="challenge-container"&gt;&lt;/div&gt; window.gokuProps = {};
&lt;iframe src="/_Incapsula_Resource?CWUDNSAI=1"&gt;&lt;/iframe&gt;
&lt;script src="https://ct.captcha-delivery.com/c.js"&gt;&lt;/script&gt;</code></pre></body></html>`,
}

describe("bot check pages", () => {
	it.each(Object.entries(WALL_PAGES))("names %s's", (name, html) => {
		expect(botCheck(html)).toBe(name)
	})

	it.each(Object.entries(PAGES))("leaves a page with %s alone", (_, html) => {
		expect(botCheck(html)).toBeNull()
	})

	it.each(["<iframe", "<script", '<iframe src="', "<title>", "<div id="])(
		"reads 64 K characters of %s in linear time",
		(start) => {
			const started = performance.now()
			expect(botCheck(start.repeat(Math.ceil(65_536 / start.length)))).toBeNull()
			expect(performance.now() - started).toBeLessThan(100)
		},
	)
})
