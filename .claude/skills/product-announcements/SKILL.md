---
name: product-announcements
description: Write or review short product release communication, such as changelog entries, release notes, app store "What's new" text, in-app announcement posts, product update emails, and social launch posts. Use when telling users about new features, improvements, or fixes.
---

# Product announcements

Announcements tell users what changed and why it matters to them. Done well, they do more than inform. A steady record of small, honest updates shows that the team listens and keeps improving the product. Closing the loop with people who asked for a feature or reported a bug builds trust.

## Before you write

1. Check the project for a voice guide, a glossary, and past announcements. Match their terms and format. If they conflict with this guide, follow the project.
2. Collect the facts:
   - What changed, from the user's point of view.
   - For fixes: what was broken, how users experienced it, and how it works now.
   - Who gets it: plans, platforms, regions, and rollout stage (beta, gradual, everyone).
   - How to use it, in steps if needed.
   - A link to help docs, if one exists.
   - People to credit, if the format credits people.
3. Translate technical sources. Pull request titles and commit messages are written for developers. Turn "Fix race in offline sync queue on cold start" into what the user saw: "Articles you saved offline sometimes didn't appear on your other devices."
4. Leave out changes with no visible effect for users.
5. Never guess availability, dates, limits, or numbers. If a fact is missing, ask, or leave a marked placeholder: `[CONFIRM: which plans get this?]`.

## Voice

- Sound like a person telling a colleague about something useful. No marketing voice.
- Make the user the subject. Not "We've added…" but "You can now…". Not "We fixed offline saving for you!" but "If articles you saved offline didn't sync, they now do."
- Use "we" to own a mistake or explain a decision. Don't use it to take credit.
- Lead with the benefit, then show how the product delivers it. A benefit without the "how" is only a claim.
- Be concrete. Say what the feature does, not how good it is.
- Be honest. Name bugs plainly. Own mistakes without over-apologizing. Say when something is in beta or has limits.
- Stay calm. Enthusiasm shows in the specifics, not in exclamation points or emoji.
- Don't apologize for a small release. A "quieter month" framing produces apologetic copy before you write a word. "Two changes worth knowing about" works better.

### Words and phrases to cut

- **Openers:** "We're excited to announce", "We're thrilled", "Say hello to", "Introducing", "Big news".
- **Hype:** "game-changer", "revolutionary", "powerful", "seamless", "next-level", "X to the rescue", "killer feature".
- **Abstract benefits:** "streamline your workflow", "boost productivity", "enhance efficiency". Replace them with the real result: "find a highlight by searching its text".
- **Promises you can't back up:** time savings ("saves you hours") and superlatives ("the best", "the most powerful").
- **Sales transitions:** "But wait…", "The best part?".
- **Filler:** "just", "literally", "simply".

## Formats

### Changelog entry

Write one or two sentences per change. Group entries under **New**, **Improved**, and **Fixed**. Name the platform if the change isn't on all of them.

Pattern: what you can do now (or what works now), plus where or when it matters.

- **New:** "You can now save a page from your phone's share menu, without opening the app."
- **Improved:** "Search results now show the site name, so you can tell similar articles apart."
- **Fixed:** "In rare cases, highlights disappeared after a site updated an article. They now show under **Unmatched highlights** while we find the cause."

Entries that need rework:

- "Use ButtonLink component for help links." Internal change, no user effect. Leave it out.
- "Archive with E in list and grid views." What was broken before? How did users notice?

### Changelog input from developers

If you write a pull request template, or ask developers for changelog notes, ask for:

- Complete sentences. Over-explain. The writer can cut context more easily than find it.
- What was wrong before, from the user's view, and how it works now.
- Plain language. No internal names, abbreviations, or code terms.

The test: the writer should not need to open the pull request to understand the change.

### App store release notes

- Lead with the one change most users will notice. Then add a short list.
- Keep it scannable. Many readers see only the first two lines.
- When a release has nothing notable, don't repeat the same "Bug fixes" line forever. Rotate a few short, true, human lines.

### In-product announcement (modal, banner, badge)

- The title names the benefit or the feature in plain words. About 25 characters.
- The body says why and how in one or two sentences. About 100 characters on mobile and 150 on desktop. Check the project's real limits.
- Buttons: one to learn more, one to dismiss ("Learn more", "Got it").
- Don't announce what the user can already see. Don't stack several announcements at once.

### Release post (What's New page, short blog post)

1. **Headline** that names the benefit: "Listen to your saved articles". Not "Introducing Audio Mode".
2. **One short paragraph:** a real situation where this helps, then what the feature does.
3. **How it works:** numbered steps with the exact UI labels in bold.
4. **Availability:** plans, platforms, rollout.
5. **Optional:** why you built it this way, or what comes next. Share trade-offs openly.
6. **Link** to the help docs. Credit the team, or the users who asked, if the format allows it.

### Product update email

- **Subject:** clear value plus a little intrigue. Name the feature or the benefit.
- **Preheader:** add new information. Don't repeat the subject.
- **Opening:** one line that earns attention before any list. A bare list of features has no thread. One framing sentence usually fixes it.
- **Each item:** the benefit, one specific image if you have a real one, and how to try it.
- **Sign-off:** a named person reads warmer than "The Team". Don't let an emoji do the warmth the sentence should do.
- **CTAs:** one per item at most, plus one main CTA.

### Social launch post

- One idea, in a few sentences at most.
- Conversational and plain. No hype, no stacked emoji or exclamation points.
- Show it working. A short video or screenshot beats adjectives. Keep key text out of images, or add alt text.
- Real use over staged polish.

## Calls to action

- Use a specific verb and, when it fits, the benefit: "Listen to an article", "See how it works", "Start your free month".
- Avoid "Click here". In longer formats, prefer a specific CTA over a bare "Learn more".
- No false urgency ("Act now!"). No promises you can't keep.

## Delight, in measure

An announcement can carry one small moment that makes a reader smile: one precise image inside functional copy. For example: "Sending articles to your e-reader now takes less effort than finding its charger." It works because you can picture it, and it doesn't slow the reader down.

- One per item or section, at most. None is fine.
- It must come from the real situation, not from a template.
- Never announce your own joke: "(automagically?!)".
- Never joke in the fix for a painful bug.
- Never invent a "real" detail. If a sentence needs a true example and you don't have one, leave a placeholder for the author:

`[REAL EXAMPLE NEEDED: a real moment when <the problem> happened to you or a user. "<generic version>" is not enough. What were you doing? What was at stake?]`

## Review

Check, in this order:

1. **Facts:** availability, platforms, limits, and steps are correct. Unconfirmed facts are marked.
2. **User first:** each item starts with what the user gains, or what now works. The user is the subject.
3. **Concrete:** every benefit comes with the "how". Nothing from the cut list remains.
4. **Honest:** bugs are named plainly. Betas and limits are stated.
5. **Format:** length, character limits, and structure fit the channel.
6. **Machine-writing tells:**
   - "It's not X, it's Y" where nobody believed X.
   - "Not only… but also".
   - A closing line that could end any announcement: "Here's to a more productive you".
   - The same sentence shape, item after item.
   - Polished sentences with no specific detail.

## Output

- **Drafting:** give the final copy. Then list every placeholder and every unconfirmed fact.
- **Reviewing:** use a table with **Original**, **Suggested**, and **Why**. Then list the missing facts. Keep each reason to one short sentence.

## In Klipstack

- **Sources.** Merged pull requests are the record of what changed: `git log` on `main`, and each pull request's **Why** and **What changes**, which describe the effects on users. Leave out changes to docs, tests, CI, and agent tooling.
- **Check facts in the repository.** Limits are in `@klipstack/api-contract`. What runs where is in the code and `docs/`. Mark anything you can't confirm there with `[CONFIRM: …]`. The examples in this guide show the patterns. They don't describe Klipstack features.
- **Availability has two more questions here.** Is it only on klipstack.com, or also on self-hosted servers once they pull the new image? Does a self-hosted server need new configuration for it, such as an AI provider key (`docs/self-hosting/`)?
- **Platforms:** the web app, the browser extension, and the iPhone app. Name the platform when a change isn't on all of them. An iPhone change reaches users only with a new App Store or TestFlight build.
- **Two languages.** App Store text and in-app announcements need English and Spanish, like every other string (see the `app-copy` skill).
- **Credit people, not agents.** Name the humans who did the work, or the users who asked. Never a coding agent.
