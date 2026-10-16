/**
 * Checks the linked starter texts (`app/starter/links.ts`): fetches each from its site and extracts
 * it as a save would. Prints its words, its minutes against the catalog's, and its title; exits 1
 * when one fails or reads too short, so a link that broke shows up before a reader finds it.
 *
 *   pnpm --filter @klipstack/web starter-links
 */
import { extractArticle, fetchPage } from "@klipstack/extract"
import { STARTER_LINKS } from "../app/starter/links"

/** Fewer words than this is a teaser, a paywall or a block page, not the text. */
const MIN_WORDS = 400

let failed = 0
for (const link of STARTER_LINKS) {
	try {
		const page = await fetchPage(link.url)
		const article = await extractArticle({ html: page.html, url: page.finalUrl })
		const words = article.wordCount
		const minutes = article.readingMinutes
		const ok = words >= MIN_WORDS
		if (!ok) failed++
		console.log(
			`${ok ? "ok  " : "FAIL"} ${link.slug}: ${words} words, ${minutes} min (catalog ${link.minutes}), "${article.title}"`,
		)
	} catch (error) {
		failed++
		console.log(`FAIL ${link.slug}: ${error instanceof Error ? error.message : String(error)}`)
	}
}
process.exit(failed ? 1 : 0)
