# Fact check experiments

How Fact check (`check` in `packages/ai`) came to ask Claude Sonnet 5.5 with at most two web
searches, from a spike in November 2026. Eight selections from six articles, chosen for claims a
reader would want checked: a historical timeline, a book count, a medical comparison, an
attribution, an agency's figure, a study's date, a quote, a leaked report. Each prompt version ran
once per case, so these show what works, not how consistent it is.

## Results

| Run | Avg cost | Worst | Avg time | Searches |
| --- | --- | --- | --- | --- |
| Ordinary Ask, Haiku 5.5, no search | 0.1¢ | 0.1¢ | 4 s | 0 |
| Fact check, Haiku 5.5, 3 searches | 2.2¢ | 3.9¢ | 11 s | 1.75 |
| Fact check, Sonnet 5.5, 3 searches | 9.8¢ | 24¢ | 8 s | 1.4 |
| Fact check, Sonnet 5.5, 3 searches, article cached | 7.7¢ | 13.5¢ | 8 s | 1.4 |
| **Fact check, Sonnet 5.5, 2 searches, article cached** | **7.4¢** | **10.6¢** | **8 s** | 1.25 |

- With Haiku, the search fee is most of the cost; with Sonnet, the results' tokens are (10,000 to
  25,000 per search, read again on each later step of the answer).
- Only one case used a third search (a quote with no primary source online), and it changed no
  verdict. Two searches is the cap.
- Haiku's verdicts varied more: one contradicted itself, and it cited blogs when a primary source
  was among its results. Sonnet's were shorter and judged sources better.

## What the prompt needed

- **Scope.** Readers often select one line of a claim that runs over several sentences (a
  timeline's total, one item of a list). The check widens to the whole unit only when the
  selection depends on its neighbours; a sentence with a claim of its own stays narrow. The first
  wording widened a self-contained sentence too. A "Checked:" line says what was checked.
- **Citations.** Haiku wrote its own markers for web pages (`[3-16]`), which read as the article's
  sentences. The prompt keeps bracket numbers for the article and has the provider cite pages.
- **Quoting.** "Never quote a source" made half the answers cite nothing: the provider's
  citations attach to cited text. "Short, in your own words" keeps them.

## The provider

- `webSearch_20250305`: with `webSearch_20260318`, the model sent its searches through code
  execution and none ran.
- The SDK sends every search result as a `source`; the ones the answer cites carry `citedText`.
  Only those are kept (`packages/ai/src/index.ts`).
