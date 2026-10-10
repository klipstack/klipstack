# AI answers in the reader

The reader can explain, define and answer questions about a passage. The answers come from
Anthropic's API, with the server's own key: when a reader asks, the server sends Anthropic the
article's text and the question, and streams the answer back. Users never see or need a key.

Two switches must both be on for anyone to see it:

- **The key** (`ANTHROPIC_API_KEY`), in the server's `.env`. Without it the feature is off for
  everyone.
- **The `ai` feature flag**, per account, in `/admin` → the account → Features in testing.

## What it costs, and the limits

Each question is one paid request. With Claude Haiku 5.5 a first question about a long article
costs about a tenth of a cent; follow-ups on the same article cost less (Anthropic caches the
article for a few minutes). Three limits keep a mistake or abuse from running up a bill:

- `LIMIT_AI_PER_MONTH` (default 500): questions per account per month, counted in
  `usage_counts` like saves. Retries and follow-ups count. Admins see it on the account's page.
- A rate limit: 30 questions per account per 5 minutes.
- **A spend limit at Anthropic**, set by you in the console (below). This is the one that holds
  even if Klipstack has a bug. Set it.

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
   environment; `up` recreates a container whose settings changed. The worker does not use the
   key.

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

## Local development and tests

- No key: set `AI_FAKE=1` in the local `.env` to get a fixed answer with one citation, without
  calling anyone. The browser tests always use it. Never set it on a real server.
- Real answers locally: a separate key (never the production one) in the local `.env`.
