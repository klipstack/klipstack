---
name: commands
description: Every change to user data goes through one command; adapters hold no rules
severity-default: high
---

Klipstack changes user data only through commands in `apps/web/app/commands/<domain>.server.ts`
("Commands" in `AGENTS.md`). Report:

- A web route action, an API handler (`apps/web/app/api/handlers`) or an MCP tool
  (`apps/web/app/services/mcp`) that writes to the database itself or calls a writing service,
  instead of calling one command.
- An adapter that imports an ungated per-action function instead of a gated command: from
  `commands/*-actions.server.ts` (such as `commands/editions-actions.server.ts`), which skip the
  feature check (`mayUseEditions`) and the input caps. Adapters import only the gated commands.
- A rule in an adapter that belongs in the command: a limit, a rate limit, an ownership check, a
  trash check, a transaction. Two adapters that would behave differently for the same input.
- A command that does not check its input against the limits in `@klipstack/api-contract`, or
  writes several rows without one transaction.
- A refusal that is not an `AppError` with a contract `ErrorCode`. A missing, trashed or foreign
  item must be `not_found`; input over a limit, `invalid_request`. In a batch, per-item outcomes
  belong in the result, not in a thrown error.
- A service that writes without taking the transaction it runs in (`tx: Db | Tx`).

Admin changes are the exception: they stay in `services/admin-*.server.ts` behind `adminMutation`.
