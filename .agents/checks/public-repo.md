---
name: public-repo
description: Nothing private enters this public repository
severity-default: critical
---

This repository is public (`AGENTS.md`, "Configuration & Dependency Rules"). Report anything in
the diff, including docs, comments, tests, fixtures and commit messages, that:

- Names or describes the klipstack.com server: host names, IP addresses, bucket names, secret
  locations, provider accounts, runbooks. Self-hosting docs use placeholders such as
  `example.com`.
- Contains a secret that has no fixed shape: a password other than the documented local demo
  and CI values, a webhook URL, a connection string with real credentials, `.env` contents
  pasted into a doc.
- Contains personal data from real accounts.
- Credits an agent in words a pattern misses, such as "written by an AI" in a description.

`scripts/check-rules.mjs` already refuses, in every file and in the pull request's title and
description: keys and tokens of known shapes (AWS, GitHub, Slack, Anthropic, OpenAI, Google,
Stripe, private keys), a tracked `.env` file, an agent as `Co-authored-by`, `Amp-Thread-ID`
lines, "Generated with" lines and links to agent threads or sessions. The orb's Amp lines in the
branch's commits are fine: the squash-merge drops them.
