# AI answers in the reader

The reader can explain, define and answer questions about a passage. The answers come from
Anthropic's API, with the server's own key: when a reader asks, the server sends Anthropic the
article's text and the question, and streams the answer back. Users never see or need a key.

Two switches must both be on for anyone to see it:

- **The key** (`ANTHROPIC_API_KEY`), in the server's `.env`. Without it the feature is off for
  everyone.
- **The `ai` feature flag**, per account, in `/admin` → the account → Features in testing. A new
  account starts with it on (and with `topics`); accounts made before keep what they had.
  With `SIGNUP_MODE=open`, that means anyone who signs up can ask questions on your key at once,
  up to the limits below: turn `ai` off for accounts you don't know.

## What it costs, and the limits

Each question is one paid request. With Claude Haiku 5.5 a first question about a long article
costs about a tenth of a cent; follow-ups on the same article cost less (Anthropic caches the
article for a few minutes). Three limits keep a mistake or abuse from running up a bill:

- `LIMIT_AI_PER_MONTH` (default 100): questions per account per month, counted in
  `usage_counts` like saves. Retries, follow-ups and article briefs count.
  `LIMIT_AI_PER_MONTH_ADMIN` (default 500) is the same for admin accounts, so you can ask more
  than the people you invite.
- A rate limit: 30 questions per account per 5 minutes.
- **A spend limit at Anthropic**, set by you in the console (below). This is the one that holds
  even if Klipstack has a bug. Set it.

## Watch what it costs

`/admin/usage`, ranked by "AI questions this month", shows each account's questions against its cap
and what its answers cost this month, in US dollars, and the month's total for every account. The
cost is estimated from each answer's tokens at Anthropic's list prices when it is finished, so a
retried or deleted answer still counts. It leaves out answers cut off midway (the reader left), a
deleted account's month, and small charges (writing Anthropic's cache costs a little more than
reading). The bill is in the Anthropic console (Usage and Cost), which is the
number to trust.

## Set it up

1. Create an Anthropic account for the server (not a personal one) at
   [console.anthropic.com](https://console.anthropic.com). Add a payment method.
2. Console → Settings → Limits: set a monthly spend limit you are comfortable losing, for example
   $20. When it is reached, Anthropic refuses requests and the reader shows "Couldn't answer".
3. Console → API keys: create a key for this server, for example `klipstack-production`. Store it
   in your password manager.
4. Add it to `.env`:

   ```sh
   ANTHROPIC_API_KEY=sk-ant-...
   ```

5. Recreate the web container so it reads the new value. `docker compose restart` keeps the old
   environment; `up` recreates a container whose settings changed. For answers in the reader,
   the worker does not use the key; automatic topics (below) do.

   ```sh
   docker compose up -d web
   ```

6. Turn the `ai` flag on for your own account in `/admin`, open an article, select a passage and
   choose Explain.

What could go wrong: a typo in the key makes every answer fail ("Couldn't answer"); the web log
has an `[ai] answer` line with `"status":"failed"`. A missing key leaves the AI buttons hidden.

## Rotate or turn it off

- Rotate: create a new key, put it in `.env` and your password manager, recreate the web
  container, then delete the old key in the console.
- Off for everyone: empty `ANTHROPIC_API_KEY` and recreate the web container. Saved answers stay
  readable. Off for one account: turn its flag off.

## What is logged

One `[ai] answer` line per answer: the thread's id, the model, the status and the token counts.
Never the article, the passage or the question.

## Privacy

The privacy policy names Anthropic as a service provider for these answers. Under its commercial
terms, Anthropic does not train models on API requests. If you run a server for other people,
tell them the same in your own privacy policy.

## Automatic topics

Topics sort each reader's articles into shelves on their own: once a library has 25 articles,
Claude Haiku proposes topics, the reader confirms them once, and from then on TypeSafe's Jev sorts
every new article into them, a few seconds after it is saved. Haiku also creates new topics when
articles pile up that fit none, and reviews the topics every 20 new articles.

The work runs in the worker, so both containers need both keys:

1. Create a TypeSafe account and an API key at console.typesafe.ai, and set a spend limit there,
   as for Anthropic.
2. Add it to `.env`, next to Anthropic's:

   ```sh
   TYPESAFE_API_KEY=your-typesafe-key
   ```

3. Recreate both containers, so both read it: `docker compose up -d web worker`.
4. Turn the `topics` flag on for your account in `/admin`, then open Topics in the sidebar and turn
   them on.

What it costs: Jev reads about 2,000 tokens of each article, a hundredth of a cent. A new or
changed topic sorts the whole library again into it, so a library of a thousand articles costs
about ten cents each time. A widened topic only sorts again the articles in no topic and those it
nearly held. Each account has two monthly caps, counted from the 1st (UTC):

- `LIMIT_TOPIC_SORTS_PER_MONTH` (default 1,000): articles sorted, first sorts and re-sorts alike.
  Sorting the library stops at three quarters of it, the first time (right after the reader
  confirms, newest first) and again, and so do growing and reviewing topics: the last quarter goes
  to new saves, which are sorted first. Past the cap, sorting stops until the next month: new
  articles wait unsorted, nothing is lost, and the Topics page tells the reader when sorting starts
  again, as it does when the library's first sort waits. The worker sorts them on the 1st without
  waiting for a new save. Raise it for readers with large libraries: turning topics on sorts the
  whole library, and every new or changed topic sorts it again.
- `LIMIT_TOPICS_PER_MONTH` (default 100): Haiku's work (proposing, growing, reviewing, and rewording a topic the reader renamed). Past it,
  sorting goes on and topics stop changing until the next month.

Set either to `0` to stop that work. Set them for the web and the worker alike: the worker
applies them, the web shows them. `/admin/usage` shows each account's articles sorted, Haiku's
work and what topics cost (both providers), apart from what questions in the reader cost.

What could go wrong: with one key missing, Topics is hidden and nothing is sent. A wrong TypeSafe
key leaves articles unsorted, and the worker log has `topics: refused` lines. A reader who turns
topics off loses them; turning them on again starts with a new proposal.

Privacy: while a reader has topics on, the text of what they save goes to TypeSafe and to
Anthropic. The privacy policy says so; if you run a server for other people, say it in yours.

## Local development and tests

- No key: set `AI_FAKE=1` in the local `.env` to get a fixed answer with one citation, without
  calling anyone. The browser tests always use it. Never set it on a real server.
- `AI_FAKE=demo`: longer fixed answers that cite three of the article's sentences, so the chat
  reads like a real one. The demo app (`pnpm orb:app`) uses it, with AI on for the demo account.
- Real answers locally: a separate key (never the production one) in the local `.env`.
