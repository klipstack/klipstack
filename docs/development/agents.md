# Working with coding agents

How this repository keeps the work of coding agents (Amp, Claude Code, others) to a standard you
can ship without redoing it. The idea: an agent proves its work before calling it done, and the
repository makes that the default, so no one has to ask for it in every conversation.

## The layers

Each layer catches what the one before can't. The lower down, the more certain.

```diagram
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ AGENTS.md            read by every agent, every session. Short: rules + pointers      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Skills               .claude/skills/*  loaded when a task matches: verify, fix-bug,   │
│                      refactor, build-feature, write-tests, review-changes, learn …    │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ pnpm verify          scripts/verify: lint, typecheck and the tests a change reaches   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Agent hooks          .claude/settings.json and .amp/plugins/ → scripts/agent-hook.mjs │
│                      no commit on main, no push to main, no --no-verify; a turn that  │
│                      changed code ends only after pnpm verify, or an honest "not yet" │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Git hook             .githooks/pre-commit: no commit on main; lint on staged files    │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Review               review-changes skill: fresh subagents, the task + .agents/checks │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ CI                   every check on every pull request; nothing merges red            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## What is enforced and what is asked

| Rule | Held by | Certainty |
| --- | --- | --- |
| No commits on `main` | Agent hooks, git hook | Enforced. A person can still bypass the git hook with `--no-verify`; agents are refused it. |
| No pushes to `main` | GitHub's ruleset on `main` (a pull request, passing CI checks, no bypass); agent hooks refuse it sooner | Enforced for everyone |
| No `--no-verify` | Agent hooks | Enforced for agents |
| Lint passes on what is committed | Git hook, CI | Enforced |
| A turn that changed code ends with `pnpm verify` passed, or says why not | Agent hooks (Claude Code, Amp) | Enforced once per turn. The agent is sent back; it may then stop, but must say so. |
| Typecheck, unit tests, build, browser tests | `pnpm verify`; CI, whose checks the ruleset requires | Enforced before merge |
| A bug is reproduced before it is fixed; tests are seen failing | Skills | Asked. Checked by the review (`.agents/checks/tests.md`) |
| Tests are not weakened to pass | Skills, review check, AGENTS.md | Asked, and reviewed |
| Commands own user-data changes; strings in both languages; security docs current | Review checks | Reviewed by a fresh agent per check |
| The owner hears about judgment calls before a pull request | AGENTS.md, release skill | Asked |
| A skill's steps go in the todo list; a skipped one shows its reason | AGENTS.md | Asked |
| A question that running something can answer is not put to the owner | `build-feature` skill | Asked |

Instructions are advice that an agent follows most of the time. Hooks and CI always hold. When a
rule matters and a script can check it, it belongs in a script: that is the job of the `learn`
skill.

## A typical task

1. You ask for a change.
2. The matching skill loads on its own. A bug brings in `fix-bug` (a failing check first),
   a feature brings in `build-feature` (your decisions first, with recommendations), a cleanup
   brings in `refactor` (the behavior pinned by tests that stay as they are).
3. The agent copies the skill's steps into its todo list. A step it skips stays there, marked
   `skip:` with a reason. It works in slices and runs `pnpm verify` as it goes.
4. If it tries to finish with unverified code, the hook sends it back once.
5. When you say the work is ready for a pull request, `review-changes` has fresh agents read the
   diff. It runs once per pull request, not during the work.
6. `release` opens the pull request with the evidence under Verification and turns on
   auto-merge: GitHub merges it when CI passes, and no agent waits for it.

## How to ask

A good request fits in a few sentences:
- **The goal.** What is wrong, or what you want.
- **What done means**, as something that can pass or fail. "The export includes every note" is a
  check; "make it better" is not.
- **The proof you want to see**: the failing and passing test, a screenshot, the API's answer, a
  number before and after.
- **What you already know**: the page, the account, the steps, an error message.
- **Real constraints**: "reproduce it first", "don't change any code yet", "no change in behavior".

Leave out how to do it, and the skills to use: the skills already order the steps. Hold back
your theory of the cause at first. A stated guess makes the agent look only where you pointed.

For a vague report, such as a long message or an issue from someone else, ask first: "restate
the problem in your own words, and don't change any code yet". A misreading shows up in the
restatement, where correcting it costs one message instead of a wrong fix.

When you move to something unrelated in the same conversation, say "new task", so the agent
starts from the matching skill instead of continuing the last one.

## Setup

- **Claude Code** reads `.claude/settings.json` when a session starts. `/hooks` shows the hooks.
- **Amp** loads `.amp/plugins/klipstack-guardrails.ts`. `amp plugins list` shows it as active.
- **The git hook** is set up by `pnpm install`, through the `prepare` script, which runs
  `git config core.hooksPath .githooks`. In this repository, that setting replaces any hooks of
  your own: those in `.git/hooks`, and a global `core.hooksPath` (husky, a company's hooks).
- **Other agents** (Codex, Cursor and others) read `AGENTS.md` and the skills, and are held by
  the git hook and CI, but not by the agent hooks.

The hooks fail open: if `scripts/agent-hook.mjs` breaks, it prints why and lets the agent
continue, instead of stopping all work. A missing `pnpm` (a GUI git client) skips the lint in the
git hook; CI still runs it.

The hooks act on the checkout where the agent works. In a git worktree, that is the worktree and
its own branch, not the main checkout. A `cd <dir>` or `git -C <dir>` earlier in a command
counts too.

The hooks compare fingerprints of the working tree: a git tree hash of every file, untracked
ones included. Each takes about 50 ms. They keep their state in `.git/klipstack-agent/` (a
worktree's in its own git directory, `.git/worktrees/<name>/`), never in the repository's own
object store. `node --test scripts/*.test.mjs` tests its rules, and CI runs it.

## Improving it

When an agent gets something wrong, say so and ask it to apply the `learn` skill. It puts the
lesson in the strongest place that can hold it: a type, then a lint rule or test, then a review
check, then a skill, then `AGENTS.md`. It proves the new rule catches the mistake, and ships it in
its own pull request. Keep `AGENTS.md` short: every session loads it. A rule that a lint now
enforces should leave it.

## Where the ideas come from

The setup adapts principles from published work rather than copying any of it:

- **Proof means the real thing.** "It compiles" is not evidence. Repeated mistakes become checks.
  An instruction you had to write twice is a sign a check is missing. A change is usually safe
  because of one fact; prove that fact by running code. Skipped steps stay visible.
  - Source: Lauren Tan's [pstack](https://github.com/cursor/plugins/tree/main/pstack).
- **Feedback loops are the speed limit.**
  - A red reproduction before any fix.
  - Thin vertical slices.
  - Decisions go to the human, facts to the agent.
  - Reviews on two axes: the task, and the standards.
  - Source: Matt Pocock's [skills](https://github.com/mattpocock/skills).
- **No completion claims without fresh evidence.** "Should" and "probably" are red flags.
  - Source: Jesse Vincent's [superpowers](https://github.com/obra/superpowers).
- **Instructions are advice; hooks are certain.** Gate the end of a turn on a check, and have a
  reviewer that did not write the code.
  - Source: Anthropic's [Claude Code best practices](https://code.claude.com/docs/en/best-practices).
- **Review checks run as separate agents**, one per check.
  - Source: Amp's [review checks](https://ampcode.com/news/liberating-code-review).
- **Engineer the harness**, so that a mistake can't happen twice.
  - Sources: Mitchell Hashimoto's
    [My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey) and OpenAI's
    [harness engineering](https://openai.com/index/harness-engineering/).
- **Deliver code proven to work**, with the evidence in the pull request.
  - Source: Simon Willison's [Proven to work](https://simonwillison.net/2025/Dec/18/code-proven-to-work/).
- **Agents game the tests they are given**, so tests and test changes need a reviewer.
  - Source: [ImpossibleBench](https://arxiv.org/abs/2510.20270).
