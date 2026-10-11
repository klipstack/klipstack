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
- Contains a secret or something that looks like one: API keys, tokens, passwords other than the
  documented local demo and CI values, private keys, `.env` contents.
- Contains personal data from real accounts.
- Credits an agent: an agent as author or `Co-authored-by`, "Generated with" lines, links to agent
  threads or sessions (ampcode.com, claude.ai).
