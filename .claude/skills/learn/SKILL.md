---
name: learn
description: Turns a correction or a repeated mistake into something that stops the next agent from repeating it. Prefers, strongest first, a type, a lint rule, a test, a script check, a review check, a skill line or an AGENTS.md line. Use when the owner corrects how an agent worked, says "don't do that again", "remember this", "always…" or "never…", when the same mistake happens twice, or when review or CI catches something an agent should have caught.
---

# Learn from a mistake

A promise to do better reaches no other session. The repository reaches every one. Put the lesson
where it is enforced, not where it is remembered.

## 1. Name the mistake

Write one sentence on what went wrong and one on what should have happened, with the place it
happened (file, command, step).

## 2. Put the rule in the strongest place that can hold it

Take the first that works:

1. **Make it impossible.** A type, or an API that cannot be misused. Or remove the wrong path.
2. **A check that fails.** Write the error message so it says what to do instead. Options:
   - an oxlint rule in `.oxlintrc.json`
   - a test
   - a step in `scripts/verify` and CI, which must stay in step with `scripts/ci-local`
   - a guard in `scripts/agent-hook.mjs`, for commands
3. **A review check**, for judgment a reviewer can see in a diff: a new section in a file in
   `.agents/checks/`, or a new file there.
4. **A step in the skill** where the work happens (`.claude/skills/`).
5. **A line in `AGENTS.md`**, only for a rule that every task needs. Every session loads it, so
   keep it short.

## 3. Prove it catches the mistake

Recreate the mistake and watch the new check fail with a message that helps. Remove the mistake
and watch the check pass. A rule nobody saw fail is a guess.

## 4. Remove what it replaces

An instruction that a lint rule now enforces is noise. Delete it. Two places that say the same
thing will drift apart.

## 5. Ship it on its own

Use its own branch and commit on `main` (`chore:`, or `docs:` when it is only words). Keep it out of
feature work, so the owner reviews the rule as a rule. Say what mistake it prevents.

Personal memory files reach neither the owner's other tools nor other agents. The repository
does.
