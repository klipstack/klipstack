---
name: security
description: Security boundaries hold and docs/security.md stays true
severity-default: critical
---

`docs/security.md` lists Klipstack's security boundaries and the tests that hold each in place.
For any change to sign-in, sessions, API keys, OAuth, MCP, admin, rate limits, request bodies,
article HTML, images, exports or anything that reads another user's data, report:

- A query or route that can reach another user's rows: a lookup by ID without the owner's user
  ID, an ownership check done after the read, an adapter that trusts an ID from the client.
- A new endpoint or action without the authentication, CSRF protection, body cap or rate limit
  its neighbours have.
- HTML, URLs or file names from users or fetched pages that reach the page, a redirect, a
  filesystem path or a SQL string without the existing sanitizer or validator.
- Secrets, tokens, emails or article content written to logs (`@klipstack/log` keeps messages out
  on purpose).
- A boundary whose behavior changed while its row in `docs/security.md`, or the tests that row
  names, did not.
