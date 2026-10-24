---
name: app-copy
description: Write or review the text inside a software product, such as buttons, dialogs, errors, empty states, forms, menus, tooltips, notifications, onboarding, and screen reader labels. Use when drafting UI strings, naming a feature in the UI, or checking existing strings for clarity, consistency, and tone.
---

# App copy

App copy is every word the product shows its users, except content the users write themselves. Its job is to help people act fast and with confidence. Clarity comes first. Personality comes second, and only when it costs no clarity.

## Before you write

1. Look for project sources first: a voice guide, a style guide, a glossary or word list, and the existing strings (for example, localization files). If they conflict with this guide, follow the project.
2. Reuse existing terms. A new word for an existing concept makes users learn two names for one thing.
3. Know the context: the component, the platform, the character limit, what the user just did, and what happens next.

## Voice

- Sound like a capable person who respects the reader's time. Not a robot, not a salesperson.
- Make the user the subject. The product is a supporting character.
- Prefer the user or the product name over "we". Write "If you couldn't save articles from your browser, you can again." Not "We fixed saving for you!"
- Be honest about consequences, limits, and errors.
- Simplify, but don't dumb down. Make every word do work, but keep the small words that make it sound human. When space allows, "Add a note" reads warmer than "Add note".

## Principles

- **Put the important thing first.** People scan the first words of each line. Start with a verb or the goal: "Save article", "Delete highlight".
- **Write plainly.** Short sentences, one idea each. Aim for an 8th-grade reading level or lower. Make instructions simpler still.
- **Pick one word per concept and keep it.** Use the same name in the button, the dialog, the help text, and the notification.
- **State consequences.** If an action destroys data, affects other people, or can't be undone, say so: "Delete highlight? You can't undo this."
- **Frame it in the positive.** Say what people can do: "Sign in to continue." Not "You can't continue without signing in."
- **Use the present tense** to describe what the product does.
- **Lead with the user's goal** when a sentence pairs a goal with an action: "Highlight a passage with the **marker icon**." Not "Use the **marker icon** to highlight a passage."
- **Name elements by their visible label.** "Select **Continue**." Not "Select the Continue button." Add "icon" only for unlabeled icons: "Select the **pencil icon**." Bold UI labels when you refer to them in a sentence.
- **Use device-neutral verbs.** "Select" or "choose", not "click" or "tap". Don't locate things by position ("top right") or color.
- **Write for translation.** No idioms, slang, wordplay, or local cultural references. Leave room, because translated text often runs longer.
- **Use numerals:** "3 articles", not "three articles".
- **Keep humor rare.** Use it only in positive moments, such as finishing something. Never use it in errors, warnings, or messages people see often. A joke that works once is annoying the fifth time. No cute language like "Oopsies!".
- **Use emoji rarely.** They can work in promotional or educational surfaces. Never put them in buttons, headings, errors, or warnings.
- **Avoid ellipses that mean "more", Markdown in strings, and exclamation points in errors or alerts.**
- **Follow platform conventions.** Default to sentence case. Some platforms, such as Apple's, use title case for some buttons and menus. Follow the platform's guidelines and stay consistent within each platform.

## Components

### Buttons

- Use a verb, usually with a noun: "Add note", "Archive article", "Show details". Not "Submit", "Yes", or "Click here".
- Keep them short and specific.
- In a dialog, the verb alone is fine when the title names the object: "Delete".
- Keep a standard set of verbs and write down what each one means. For example:
  - **Delete:** remove for good.
  - **Remove:** take out of a list, or unshare, without destroying it.
  - **Discard:** throw away unsaved edits or drafts.
  - **Cancel:** close without changes.
  - **Archive:** hide, but keep.
  - **Set:** add a value for the first time. **Update** or **Change:** edit an existing value.
  - **Got it:** dismiss an information message.
  - **Learn more:** open detailed help.
- Decide once between pairs like "Log in" and "Sign in". Then never mix them.

### Dialogs

- **Title:** a short question or statement that names the object: "Delete collection?" No "Are you sure?", no "Warning", no "Sorry".
- **Body (optional):** what will happen, in one or two sentences, with a period: "This deletes “Weekend reads” and its 12 saved articles. You can't undo this."
- **Buttons:** a primary action that matches the title verb ("Delete"), plus a way out ("Cancel").

### Errors

- Say what happened in plain words: "This article couldn't be saved because the site requires a login."
- Say what to do next: "Sign in to the site in your browser, then save it again."
- No jargon and no blame. If you show an error code, put it after the human explanation.
- Skip "please" and routine "sorry". Phrase the fix in a friendly way instead: "To save a page, use the browser extension or paste its link here." Save apologies for real failures on your side, so they keep their meaning.
- Put the error next to the thing that caused it.

### Empty states

- Explain what the screen is for and the first useful action.
- They can carry a small moment of warmth, because the moment is low-stakes. A queue the user has finished can say: "All caught up. Enjoy the quiet."
- Link to help if the concept needs more than a line.

### Forms and inputs

- Ask only for what you need. Order fields from easiest to hardest, like a conversation.
- Labels are one or two words: "Name", not "What is your name?"
- Don't put important information in placeholder text. Keep labels and hints outside the field.
- Mark optional fields as "Optional".
- Put format hints and rules under the field: "At least 8 characters."
- Show validation errors next to the field. Say what is wrong and how to fix it.

### Menus

- Use familiar words. No invented terms.
- Skip articles: "Add tag", "Move to collection".
- In a context menu, don't repeat the object's name: "Edit", "Duplicate", "Delete".
- Front-load the key word: "Import from CSV".

### Notifications and activity

- Say who did what to which thing: "**Ana** added 3 articles to **Weekend reads**."
- Be concise, but not cold or robotic.

### Toasts and snackbars

- Use up to two lines. Say what happened: "Article archived."
- Offer one action when it helps: "Undo".

### Tooltips

- For icons: verb first, a few words, no period: "Edit", "Mark unread", "Close menu".
- Don't repeat text that is already visible.
- For extra information: short, full sentences with a period.

### Onboarding

- Help people get one real result fast. Point to the next action, not the whole feature list.
- Link to fuller help instead of explaining everything in the UI.

### In-product feature announcements (modals, badges)

- Lead with the benefit, then say how to use it.
- Typical limits: a title of about 25 characters, and a body of about 100 characters on mobile or 150 on desktop. Check the project's real limits.
- Buttons: "Learn more" and "Got it".
- For longer release communication, use the `product-announcements` guide.

### Links

- Link text says where it goes: "Read the import guide." Not "Click here."
- Don't include leading articles or trailing punctuation in the link.

### Accessibility text

- **Alt text:** describe what the image shows in one or two sentences. Skip decorative images.
- **`aria-label`** (or the platform equivalent) for controls without visible text:
  - One to three words. Give context: "Close welcome dialog", not "Close".
  - Say the function, not the shape: "Close", not "X".
  - Put the key word first: "Edit highlight", not "Highlight edit".
  - Capitalize the first word. No period.
  - Don't add "button" or "icon". The screen reader already announces the role.
- **`aria-describedby`:** connect hints and instructions to their field, so screen reader users hear them before they act. Use sentence case, no period, and device-neutral verbs ("Activate to edit", not "Click to edit").
- Don't add a label when visible text already describes the element.
- Pair icons with text labels where possible.
- Test with a screen reader.

## Default mechanics

Use these unless the project's style guide says otherwise.

- Sentence case for buttons, labels, menus, and headings.
- Contractions are fine: "can't", "you're".
- Let the locale format numbers, dates, times, and currency. Don't hard-code formats in strings.
- Smart quotes in user-facing text: “ ” ’.
- "OK" in buttons and UI. "okay" in running text.
- No "&" unless space forces it.
- Use ">" for navigation paths: **Settings > Account**.
- Write keyboard shortcuts with capitalized keys joined by "+": `Shift + V`, `Cmd/Ctrl + K`.

## Review checklist

For each string, ask:

1. Can a first-time user act on it without help?
2. Do the first words carry the meaning?
3. Does every term match the rest of the product?
4. Are the consequences, and any irreversibility, clear?
5. Is it positive, in the present tense, and free of jargon?
6. Will it survive translation and fit the space?
7. Does it work without sight: labels, alt text, no position cues?
8. If there is humor, is it in a positive moment, and is it safe to see 50 times?

## Output

- **Drafting:** give the string, its component, and its character count when there is a limit. Offer two or three options only for prominent strings, such as titles, primary buttons, and empty states. Flag any new term you introduce.
- **Reviewing:** use a table with **Original**, **Suggested**, and **Why**. Keep each reason to one short sentence. Group by issue type when there are many.
