# Automatic topics: experiments

What the topics simulator (`apps/web/scripts/topics`, `pnpm --filter @klipstack/web topics`) was
used to try, what it showed and what was decided. Read this before trying the same idea again.

## Running a simulated reader

`run --reader` adds a reader played by another model (Sonnet). Every `--reader-every` articles it
looks at a share of the library (`--attention`, always the same articles). It takes an article out
of a topic where it would not look for it, and now and then renames or removes a topic, also when
confirming the first ones. It sees names and descriptions, never boundaries. `--taste strict` makes
it keep shelves narrow. At the end it judges every article against the final topics, and the run
records how many applied placements it agrees with (precision) and how many of the placements it
wants are applied (recall). The simulation keeps production's rules: an article taken out of a topic
never comes back, and its refusal carries over to what replaces the topic; a review never renames,
merges, splits or retires a topic the reader named; a removed name never returns.

Production's settings, as in `TOPIC_RULES`:

```sh
pnpm --filter @klipstack/web topics run --classifier jev --bootstrap 25 --apply 0.6 --suggest 0.4 \
  --pool 5 --maintain 20 --style sections --question shelf --widen --reader --taste strict --name x
```

Haiku's answers vary from run to run: compare variants over several `--sample N` runs each. Two
runs with identical prompts differed by up to 6 points of precision, and runs of one variant by up
to 30.

## Telling the review about readers' corrections (October 2026): not built

**The idea.** The review (every 20 articles) would hear the readers' corrections: the articles
taken out of each topic since the review last changed it, which topics the reader named, and which
topics the reader removed. It could then `narrow` a topic, changing its description and boundary
but keeping its name. A variant also told growth not to widen a topic toward what was taken out of
it. Another variant said when one topic sits mostly inside another ("7 of its 10 articles are also
in Software Engineering"), so that the review narrows the broader one instead of merging the two.

**The test.** We ran the demo library (66 articles) and the owner's library (94 articles) at
production's settings, with 5 samples per variant.

| library | review | precision | recall | taken out after the first review |
| --- | --- | --- | --- | --- |
| demo | as in production | 80% | 80% | 2.0 |
| demo | hears corrections | 89% | 73% | 1.4 |
| demo | and growth hears them | 82% | 73% | 3.2 |
| owner | as in production | 93% | 77% | 4.4 |
| owner | hears corrections | 93% | 76% | 3.0 |
| owner | and growth hears them | 93% | 78% | 4.6 |

**What it showed.**

- A reader of ordinary taste corrected nothing: 0 takeouts, renames or removals in either library.
  Jev's shelving already matches what it expects, so the review would rarely have anything to hear.
  Corrections only came from the strict reader.
- The review did what it was told. Every narrowing cited the article taken out, and the reader's
  rules held in every run. But the topics got no better: on the demo, precision rose about as much
  as recall fell, and on the owner's library nothing moved. Takeouts fell by about a third, within
  the noise, and rose again when growth heard them too.
- Growth undoes narrowing: 21 narrowings were followed by 27 widenings of the same topics, often
  within a few articles. Telling growth about the takeouts did not stop it.
- The "inside another topic" hint never fired. Sections-style topics sorted by the shelf question
  rarely nest: the most was 7 of 13 articles (54%), usually 1 or 2. The "7 of 10" case came from
  the older topic styles.
- Renames and removals were not really tested: the simulated reader made 1 rename and no removal in
  about 45 runs.

**Decided.** Not built. The simulated reader stays in the simulator.

**Worth trying instead.** Descriptions keep growing through widening ("including X, Y and Z").
Limiting widening is the more likely lever. Try it only with a reader that corrects, and over
several samples.
