# The iPhone app in the App Store: readiness checklist

What stands between the iPhone app (`apps/mobile`) and TestFlight and the App Store, for the
owner. Each item says what it is, why Apple checks it, and where it stands. Apple's rules are the
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/); the numbers
below (4.8, 5.1.1, …) are theirs.

Status as of October 20, 2026: enrolled as Klipstack SpA; the app is in App Store Connect, with
builds uploaded. External testing hasn't started.

## Needed the paid team

The Apple Developer Program (team Klipstack SpA) is needed for all of these; a free personal team
can't do any of them.

- **Switch the team.** Done: device and TestFlight builds are signed by the team in
  `APPLE_TEAM_ID`, in `apps/mobile/.env.local` (never in the repo; `app.config.ts` reads it). The
  server's `APPLE_TEAM_ID` (below) is a separate setting with the same value.
- **App IDs and the app group.** Done: `com.klipstack.mobile`, `com.klipstack.mobile.share` and
  `com.klipstack.mobile.widget`, all three in the app group `group.com.klipstack`; Associated
  Domains and Sign in with Apple are on for the app. The first choice, `com.klipstack.app` and
  `group.com.klipstack.app`, is held by the free personal team that signed the early device builds,
  and Apple gives an identifier to one team only. The sign-in's custom scheme stays
  `com.klipstack.app` (`MOBILE_REDIRECT_URI`), listed in `app.json`'s `scheme`: it was the bundle
  ID, which Expo registers as a scheme on its own.
- **Universal links, the app side.** Done. klipstack.com serves the file (`APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`), and Apple's copy at
  `https://app-site-association.cdn-apple.com/a/v1/klipstack.com` matches. The app has
  `applinks:klipstack.com` and `webcredentials:klipstack.com` in its Associated Domains, requires
  iOS 17.4, and signs in with `https://<server>/app/oauth/callback` (`mobileRedirectUri` in
  `packages/api-contract/src/auth.ts`) through `preferUniversalLinks: true`: `expo-web-browser`
  hands an https callback to the app only with that, and only from iOS 17.4. Against the http dev
  server it keeps the custom scheme. An https server accepts only the universal link
  (`mobileRedirectUris`), so builds from before it can't sign in to klipstack.com again: install a
  new one.
- **Sign in with Apple.** Done, on the web ([#145](https://github.com/klipstack/klipstack/pull/145))
  and in the app's own sign-in ([#146](https://github.com/klipstack/klipstack/pull/146)). Required
  by guideline 4.8 while Google or GitHub sign-in is offered (see "The rule", below). The server's
  setup is in `docs/self-hosting/sign-in-providers.md`.
  - Deleting an account that signed in with Apple also revokes its Apple tokens, not only our rows.
  - To check: readers can hide their address behind `…@privaterelay.appleid.com`. Apple forwards
    mail to those only from senders registered under "Sign in with Apple for Email Communication"
    in the developer portal. Register Klipstack's sending address there, or emailed codes and
    resets never arrive.
- **The TestFlight build and upload.** `pnpm ios:testflight` (in `apps/mobile`) archives a
  release build and uploads it to App Store Connect, signed in with the Xcode account of the team.
  The build number is the upload's time, so each upload is higher; the version is `app.json`'s.
  *Why:* TestFlight is the only way to put the app on testers' phones without connecting each phone to
  the Mac, and App Review reviews uploaded builds. The first build for external testers gets
  a short review too.
- **The App Store link on the update screen.** Done: `apps/mobile/src/app/update.tsx` opens
  `https://apps.apple.com/app/id6824513146`. *Why:* App Review checks that every screen has a way
  forward; a dead end can be a rejection under 2.1 (app completeness). That page exists only once
  the app is released in the App Store: until then, testers update in TestFlight, so don't raise
  the server's minimum version for them alone.

## Done in code

- **Account deletion in the app** ([#99](https://github.com/klipstack/klipstack/pull/99)):
  Account → Delete account. *Why:* guideline 5.1.1(v): an app that lets people have an account
  must let them delete it from inside the app. The reader types the account's email to confirm.
  When the last sign-in is older than 30 minutes, it asks to sign in again, in a sheet with the
  sign-in screen's ways in (Apple, Google, GitHub, password, emailed code), so every account can
  delete itself in the app. Only a session the app didn't sign in itself (a development API key)
  gets a link to Settings on the web instead.
- **AI only through the app's own sign-in** ([#96](https://github.com/klipstack/klipstack/pull/96)):
  the API's AI endpoints answer only tokens issued to the iPhone app. *Why:* it keeps the AI's
  cost tied to Klipstack's own apps, and it means the AI a reviewer sees is the only way the app
  sends anything to an AI provider.
- **The privacy policy** (this branch): `/privacy` now says what the reader's AI (Explain,
  Define, Ask, Chat, the brief) sends to Anthropic and only when the reader asks, on the web and
  in the app; that dictation and reading aloud run on the phone; what the share extension and the
  widget read; and that the account can be deleted in the app. *Why:* Apple compares the App
  Privacy answers and the app with this page, and guideline 5.1.2(i) requires saying which third
  parties, AI included, receive personal data.
- **Universal links, the server side** (this branch): `/.well-known/apple-app-site-association`,
  built from `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID`, for the callback path
  `/app/oauth/callback` only. Unset, it answers 404. See "Universal links, the app side" above.
- **A consent sheet before the first AI request** (this branch): before the reader's first Explain,
  Define, Ask, brief or chat, a sheet says that the article's text and what is asked go to
  Anthropic, and that nothing is sent until the reader asks; Continue or Not Now. The choice is
  kept on the account (`PUT /ai/consent`), so it holds in the app on every device, and Account →
  AI answers shows and changes it. *Why:* guideline 5.1.2(i) asks for clear disclosure and
  permission before personal data goes to a third-party AI. The web reader does not ask: it is
  not reviewed by Apple, and it never did.
- **iPad off** (this branch): `supportsTablet: false`; the share extension and the widget are iPhone-only
  too. The app runs on iPads in iPhone mode. *Why:* an app that runs on iPad is reviewed on iPad
  too, with iPad screenshots; the app is designed for the iPhone.
- **The encryption key** (this branch): `ITSAppUsesNonExemptEncryption: false` in the app's
  Info.plist. *Why:* the app only uses the encryption built into iOS (HTTPS); with the key, App
  Store Connect doesn't ask the export question for every build.
- **A privacy manifest** (this branch): `ios.privacyManifests` in `app.json` declares the
  required-reason APIs of the app and its pods (file timestamps, `UserDefaults`, boot time, disk
  space) and the data in the App Privacy table below. The share extension and the widget call none
  of those APIs, so they need no manifest of their own. *Why:* Apple refuses uploads that use these
  APIs without declaring why.
- **No local networking in release builds** (this branch): the share extension and the widget reach the
  local dev server only in development builds (`plugins/with-extension-settings.js`).
- **The app's own sign-in and sign-up** ([#146](https://github.com/klipstack/klipstack/pull/146),
  [#148](https://github.com/klipstack/klipstack/pull/148)): Sign in with Apple in iOS's sheet,
  Google and GitHub on the provider's page in a sign-in sheet, and the email with a password or
  an emailed code. "Create an account" asks for an invite code first, unless the server's sign-up
  is open ("Request one" opens the wait list in Safari), then offers the same ways; the email one
  is confirmed by an emailed code. An unverified account signs in to the app only with an emailed
  code, which verifies it. *Why:* guideline 4.8, below.
- **No Klipstack web page inside the app**: the Google and GitHub sheet (expo-auth-session's) goes
  from `/app/sign-in/<provider>` straight to the provider and back to the app.
  - Account's "On the web" rows, the sign-up's Terms and "Request one", and the privacy link of
    the AI consent sheet open Safari, outside the app. A lint rule refuses `expo-web-browser` in
    `apps/mobile/src`, so an in-app browser can't come back unnoticed.
  - *Why:* guideline 4.8. A reviewer who tapped Terms, then Log in, or a web row in Account, saw
    "Continue with GitHub" inside the app.
- **Older builds sign in on the web** ([#105](https://github.com/klipstack/klipstack/pull/105)):
  builds from before #146 open the web's `/login` and `/signup` in a browser sheet. Reached from
  there (they carry the app's signed authorization request), those pages offer no provider
  button, show no brand link to the landing page, and their "Log in" goes back to the app's
  `/login`. The request expires after 10 minutes; from then on, the sheet's `/login` shows only
  "start again from the app". Signing up there needs a password, and the email is verified in
  Safari before the app connects.

## What the owner does in App Store Connect

### App Privacy (the "nutrition labels")

Apple asks which data the app collects, whether it is linked to the person, and whether it is
used to track them. "Collected" means it leaves the phone and is kept longer than it takes to
answer the request. Klipstack tracks no one: answer "No" to tracking everywhere. What the app
handles, by Apple's categories:

| Apple's category | What it is in Klipstack | Linked to the person | Purpose |
| --- | --- | --- | --- |
| Contact Info → Name, Email Address | The account | Yes | App Functionality |
| Identifiers → User ID | The account's id | Yes | App Functionality |
| User Content → Other User Content | Saved links and their pages, highlights, notes, tags, saved searches, feeds, AI questions, answers and briefs | Yes | App Functionality |
| Usage Data → Product Interaction | The monthly counts per account (saves, questions, topic use, limits hit) | Yes | App Functionality, Analytics |
| Browsing History | Arguably the saved links, which are web pages; declaring it is the cautious answer | Yes | App Functionality |
| Search History | Arguably the saved searches; declaring it is the cautious answer | Yes | App Functionality |

Not collected: audio (dictation is recognized on the phone and only the note's text is sent),
location (the sign-in keeps an IP address with the session to protect the account, but nothing
derives a location from it), contacts, photos, health, purchases, diagnostics (no crash reports,
no analytics SDK). Third parties that receive data for us (Anthropic, TypeSafe, the host) count as
our own collection, not as tracking. Keep the labels and `/privacy` saying the same thing.

### Age rating

The questionnaire asks, among others, about unrestricted web access. The reader shows any page a
person saved, so "Yes" is the cautious answer: it sets the highest age rating (it has been 17+,
18+ in the current system), which suits the policy's "not meant for anyone under 16". "No" is
arguable, since the reader is not a browser, but a reviewer who opens any page in it could
reject the app for a wrong rating.

### Screenshots

iPhone screenshots at the sizes App Store Connect asks for (one set at the largest size can be
scaled). Show real use: Home, the reader with a highlight, an AI answer, the library. Use the
demo account's articles, not someone's real library. With iPad off, no iPad screenshots.

### URLs

- Support URL: `https://klipstack.com/support`
- Privacy Policy URL: `https://klipstack.com/privacy`

### Review notes

App Review reads these before testing. Say:

- The review account's email and password (in App Store Connect only; see below). On the app's
  first screen, type them and tap Sign in.
- **Signing in:** the first screen is the app's own. It offers Sign in with Apple (iOS's sheet),
  Continue with Google and Continue with GitHub (the provider's page in a sign-in sheet), and the
  email with a password or with a code sent by email. No Klipstack web page opens inside the app.
- **Creating an account:** "Create an account" on that screen. Klipstack takes new accounts by
  invite for now, so it asks for an invite code first ("Request one" joins the wait list in
  Safari). Give an unused code for the reviewer (in App Store Connect only; see below). Then: Sign
  up with Apple, Google or GitHub, or a name, email and password confirmed by an emailed code.
- **Deleting the account:** Account (the header's account button) → Delete account, then type the
  account's email. When the last sign-in is older than 30 minutes, it asks to sign in again, with
  the same ways in.
- **Background audio:** the app declares the `audio` background mode to keep reading an article
  aloud with the screen locked. To see it: open an article, tap the headphones (Read aloud), lock the phone.
- **Dictation:** the microphone and speech recognition are asked for only when dictating a note,
  and recognition runs on the device (`requiresOnDeviceRecognition`); nothing said is sent
  anywhere.
- **AI features:** open an article, then the sparkles button for "Sum Up This Article" and "Chat
  About This Article", or select text for Explain, Define and Ask. Answers come from Anthropic's
  Claude, only when asked.
- The share extension (Share → Klipstack in Safari) and the "Next up" widget.
- The first AI request asks first: a sheet says what is sent to Anthropic. The choice can be
  changed in Account → AI answers.

### Export compliance

Answer that the app uses encryption, and that it is exempt: only the encryption in iOS itself, for
HTTPS. With the Info.plist key (done above) App Store Connect stops asking per build.

## A review account on production

Apple needs an account to sign in with. Never put its credentials in this repository (it is
public) or in a pull request: they go only in App Store Connect's review notes.

1. Pick an address you can read and that is only for this, such as an alias of your own mailbox.
2. On klipstack.com, create an invite in `/admin/invites`. In the app, tap "Create an account",
   enter the invite code, and sign up with a name, the address and a password (not Apple, Google
   or GitHub: the reviewer types an email and a password). The emailed code verifies the address.
   An unverified account can't sign in to the app until it uses an emailed code.
3. Save a dozen varied articles to it, so the library, Home and search have something to show.
4. In `/admin/users`, open the account, and check that "Features in testing" has `ai` and `topics`
   on (a new account starts with both).
5. Sign in to it on the web, open Topics and turn topics on, then confirm the proposed topics.
6. Sign in to it in the app once and check: an AI answer, the brief, reading aloud, the widget.
7. Create a second invite in `/admin/invites`, for the reviewer to try "Create an account". Invite
   codes are single-use and not tied to an address.
8. Put the email, the password and the second invite code in the review notes. After the review,
   change the password and revoke the invite if it is unused.

The reviewer may test account deletion on it. If they do, repeat these steps before the next
submission. Its AI questions count against the monthly cap like anyone's.

## The rule: Sign in with Apple when Google or GitHub is offered

Guideline 4.8: an app whose sign-in offers a third-party or social login (Google, GitHub) must also
offer an option with Apple's privacy guarantees, which in practice means Sign in with Apple. Email
and password, or our own emailed links, don't count as third-party and need nothing extra.

GitHub sign-in is on at klipstack.com, and the app's own sign-in screen offers the providers the
server lists, with Sign in with Apple first, in Apple's own sheet. The server accepts the ID tokens
Apple issues to the app's bundle ID. The web's login page, which builds from before that screen
open, offers the iPhone app no provider at all (`APPLE_PLATFORM_CLIENTS`, `offeredIn` in
`apps/web/app/lib/provider-sign-in.server.ts`): a trip to a provider would leave the app's request
behind and end on the web inside the sheet.
