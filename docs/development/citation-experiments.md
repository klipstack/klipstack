# AI citations: experiments

How the brief and the answers cite the article, what was tried and what it showed. Read this
before changing how citations work or the prompts' rules about them.

## Measuring

`pnpm --filter @klipstack/web citations` asks the real model (`ANTHROPIC_API_KEY`) for briefs and
answers about the demo corpus (`pnpm demo:capture`), through `@klipstack/ai` as the app does. For
every place the answer cites, it takes the words the citation follows (the sentence it ends) and
counts it as copied when those words share 30 or more characters with the cited passage. `--judge`
also asks Opus whether each passage supports its words: yes, partly or no. `--spanish N` answers
in Spanish about the first N articles too.

```sh
pnpm --filter @klipstack/web citations --spanish 20 --judge
```

A run of the whole corpus with the judge makes about 360 requests to Haiku and as many to Opus,
and takes about half an hour.

A shared run of 30 characters also catches names, terms the answer puts in quotation marks and
short facts ("no smartphones before high school"). Read some of the answers (`--out`) before
trusting a change in the number.

## The provider's citations repeated the article (October 2026): replaced

**What happened.** The article went to Haiku as a document with Anthropic's citations on. The text
a citation is attached to tended to repeat the cited passage almost word for word: the model wrote
its own sentence, then the article's. In answers the quote was often spliced into the sentence
("'This process' refers to what the sense of threat can lead to…"), sometimes breaking its
grammar, and some answers were mostly quotes, the author's "I" included ("My research suggests…").
In Spanish answers, a quarter of the citations pasted the article's English. The prompt's "say it
in your own words" did not stop it, nor did stronger wording.

**The test.** 65 demo articles; a brief, Explain, Define, Ask and Chat in English, and a brief,
Explain and Chat in Spanish for 20 of them: 760 answers. Each answer was asked two ways: as
production did, and with citations off and the article sent one numbered sentence per line, the
model citing by number (`[12]`). Opus judged each citation, and, blind, which answer of each pair
a reader would rather get.

| | provider's citations | numbered sentences |
| --- | --- | --- |
| English: citations after copied words (30+ characters) | 71% | 11% |
| English: (60+ characters) | 50% | 1% |
| Spanish: (30+ characters) | 25% | 0% |
| Passage doesn't support the words | 1% | 0% |
| Passage supports them partly | 20% | 28% |
| Preferred in the blind comparison (of 380) | 42 | 330 (8 the same) |
| Input tokens per request | 9,250 | 6,700 |

By kind, in English, copied (30+ characters): brief 40% → 4%, Explain 86% → 14%, Define 90% →
18%, Ask 89% → 16%, Chat 82% → 10%.

"Partly" rose because a quote trivially supports itself; with numbers, the model paraphrases and
generalises a little. The numbers were right: "no" did not rise. Sonnet 5.5 with the provider's
citations copied less (9% of 55 citations) but costs 20 times Haiku's price. Taking the copied
words out of the answer afterwards was not tried: they usually carry the sentence, and taking them
out leaves "refers to the chain described just before:" or an empty answer.

**What was built.** `packages/ai/src/sentences.ts` splits the article into sentences (paragraphs at
blank lines, then `Intl.Segmenter` with spaces collapsed, since pages break lines mid-sentence).
The model reads them numbered; `markers.ts` turns its markers into citations as the answer
streams, each the range of whole sentences, neighbouring ones together. A chip now always points
at whole sentences. Answers and briefs kept from before are left as they were.

The measuring script on what was built (60 articles, 360 answers, the citations in one place
counted together): copied 11% in English (brief 6%, Explain 13%, Define 13%, Ask 18%, Chat 9%), 0%
in Spanish; the passage supports the words 72% (English) and 76% (Spanish), partly 27% and 23%,
not 1%.

**Still open.** About 1% of answers use a marker as a word ("In [24], the narrator…"); the marker
comes out and leaves "In , the narrator". A sentence may carry three to five chips when the model
cites several sentences apart.
