# The iPhone app in the App Store: readiness checklist

What stands between the iPhone app (`apps/mobile`) and TestFlight and the App Store, for the
owner. Each item says what it is, why Apple checks it, and where it stands. Apple's rules are the
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/); the numbers
below (4.8, 5.1.1, …) are theirs.

Status as of October 19, 2026: enrolled as Klipstack SpA; the app exists in App Store Connect.

## Blocked on the enrollment

A paid team is needed for all of these. The free personal team that signs today's device builds
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
- **Universal links, the app side.** The server side is done and off (below). Then:
  1. Set `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID=com.klipstack.mobile` in klipstack.com's environment
     and redeploy. `https://klipstack.com/.well-known/apple-app-site-association` then answers
     the file instead of 404. Apple's servers fetch it, not the phone: check what they hold at
     `https://app-site-association.cdn-apple.com/a/v1/klipstack.com` (it can take a day to
     update).
  2. The app thread adds `applinks:klipstack.com` and `webcredentials:klipstack.com` to the
     app's Associated Domains and signs in with the https callback
     `https://klipstack.com/app/oauth/callback` (`MOBILE_CALLBACK_PATH` in
     `packages/api-contract/src/auth.ts`). `expo-web-browser` hands an https callback back to the
     app only with `preferUniversalLinks: true` and on iOS 17.4 or later; the app sets no minimum
     iOS version today, so either raise it to 17.4 or keep the custom scheme on older versions.
  3. Register that redirect on the `klipstack-mobile` client (`apps/web/app/lib/auth.server.ts`),
     next to the custom scheme, which older builds keep using until they are below the minimum
     version.

  *Why:* today the app receives its sign-in through the custom scheme
  `com.klipstack.app:/oauth/callback`, which any iOS app can claim. Another app could then catch a
  reader's sign-in and act as them, delete the account included (`docs/security.md`, "Mobile app
  sign-in"). Only an app signed by the team in that file can open a universal link, so this has
  to be done before the app reaches anyone but us.
- **Sign in with Apple.** Required by guideline 4.8 while Google or GitHub sign-in is offered
  (see "The rule", below). It needs a Services ID and a key from the developer portal, a provider
  on the server (better-auth has one), and the button on the login page. Two things Apple adds:
  - Readers can hide their address behind `…@privaterelay.appleid.com`. Apple forwards mail to
    those only from senders registered under "Sign in with Apple for Email Communication" in the
    developer portal: register Klipstack's sending domain, or sign-in links and resets never
    arrive.
  - Deleting an account that signed in with Apple must also revoke its Apple tokens (Apple's
    REST API), not only delete our rows.
- **The TestFlight build and upload.** `pnpm ios:testflight` (in `apps/mobile`) archives a
  release build and uploads it to App Store Connect, signed in with the Xcode account of the team.
  The build number is the upload's time, so each upload is higher; the version is `app.json`'s.
  *Why:* TestFlight is the only way to put the app on testers' phones without the 7-day signing of
  device builds, and App Review reviews uploaded builds. The first build for external testers gets
  a short review too.
- **The App Store link on the update screen.** Done: `apps/mobile/src/app/update.tsx` opens
  `https://apps.apple.com/app/id6824513146`. *Why:* App Review checks that every screen has a way
  forward; a dead end can be a rejection under 2.1 (app completeness).

## Done in code

- **Account deletion in the app** ([#99](https://github.com/klipstack/klipstack/pull/99)):
  Account → Delete account. *Why:* guideline 5.1.1(v): an app that lets people have an account
  must let them delete it from inside the app. It asks to sign in again when the last sign-in is
  older than 30 minutes. An account without a password (Google, GitHub or emailed links only)
  is sent to Settings on the web to delete it; Apple accepts a link that leads straight to the
  deletion, but it is a point a reviewer could raise. Hiding Google and GitHub in the app's
  sign-in (below) makes it rarer.
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
  `/app/oauth/callback` only. Unset, it answers 404, as klipstack.com does today. See "Universal
  links, the app side" above for turning it on.
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
- **Google and GitHub hidden in the app's sign-in** ([#105](https://github.com/klipstack/klipstack/pull/105)):
  `/login` and `/signup` reached from the app's sign-in (they carry its signed authorization
  request) offer no provider button unless Sign in with Apple is among them. The web's own sign-in
  is unchanged. People whose account has only Google or GitHub can't sign in in the app until they
  set a password in Settings on the web. *Why:* guideline 4.8, below.
- **No way from the app to the web's own sign-in** (this branch): the sign-in sheet is the only
  Klipstack page inside the app.
  - Account's "On the web" rows, "Use the web" in Delete account and the privacy link of the AI
    consent sheet open Safari, outside the app. A lint rule refuses `expo-web-browser` in
    `apps/mobile/src`, so an in-app browser can't come back unnoticed. In Safari the reader has their
    web session, or signs in their own way: an account without a password signs in with Google or
    GitHub there, and can delete itself. Apple accepts a link to the website for deletion
    (5.1.1(v)).
  - Inside the sign-in sheet, the Terms, Privacy and Support links (and the request-invite page)
    carry the app's signed request. Those pages then show no brand link to the landing page, and
    their "Log in" goes back to the app's `/login`. The consent page's brand is not a link either.
    Without the request, these pages are as before.
  - The signed request expires after 10 minutes. From then on, the sheet's `/login` shows only
    "start again from the app": no form, no email-link pages, no way into the web library. Sign-up
    and the consent page's "Use another account" end there too.
  - *Why:* guideline 4.8. A reviewer who tapped Terms, then Log in, or a web row in Account, saw
    "Continue with GitHub" inside the app.
- **Signing up in the app's sign-in comes back to the app** (this branch): `/signup` keeps the
  app's request and needs a password there (an emailed sign-up link would open in Mail's browser,
  outside the sheet). After the account is made, the request goes on: the email isn't verified
  yet, so the provider stops at `/oauth/verify-email`, which sends the verification link. The
  reader opens it in Safari, logs in there with the new password if Safari asks (the link verifies
  only a signed-in account; in the simulator Safari did not have the sheet's session), comes back
  to the app and taps
  Continue: the consent screen, then the app, signed in. The request expires 10 minutes after the
  page was last shown; then the page says to start again from the app. An existing unverified
  account that logs in from an app stops on the same page, instead of Settings.

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

- The review account's email and password (in App Store Connect only; see below).
- **Background audio:** the app declares the `audio` background mode to keep reading an article
  aloud with the screen locked. To see it: open an article, tap the headphones (Read aloud), lock the phone.
- **Dictation:** the microphone and speech recognition are asked for only when dictating a note,
  and recognition runs on the device (`requiresOnDeviceRecognition`); nothing said is sent
  anywhere.
- **AI features:** open an article, then the sparkles button for "Sum Up This Article" and "Chat
  About This Article", or select text for Explain, Define and Ask. Answers come from Anthropic's
  Claude, only when asked.
- The share extension (Share → Klipstack in Safari) and the "Next up" widget.
- Sign-in opens Klipstack's sign-in page in a system sheet; the account is created on the web.
- The first AI request asks first: a sheet says what is sent to Anthropic. The choice can be
  changed in Account → AI answers.

### Export compliance

Answer that the app uses encryption, and that it is exempt: only the encryption in iOS itself, for
HTTPS. With the Info.plist key (done above) App Store Connect stops asking per build.

## A review account on production

Apple needs an account to sign in with. Never put its credentials in this repository (it is
public) or in a pull request: they go only in App Store Connect's review notes.

1. Pick an address you can read and that is only for this, such as an alias of your own mailbox.
2. On klipstack.com, create an invite for it in `/admin/invites` and sign up with a password
   (not Google or GitHub: the reviewer types an email and a password). Verify the email (Settings
   → Account sends the link): an unverified account can't connect an app, so the app's sign-in
   would fail at the consent step.
3. Save a dozen varied articles to it, so the library, Home and search have something to show.
4. In `/admin/users`, open the account, and under "Features in testing" turn on `ai` and `topics`.
5. Sign in to it on the web, open Topics and turn topics on, then confirm the proposed topics.
6. Sign in to it in the app once and check: an AI answer, the brief, reading aloud, the widget.
7. Put the email and password in the review notes. After the review, change the password.

The reviewer may test account deletion on it. If they do, repeat these steps before the next
submission. Its AI questions count against the monthly cap like anyone's.

## The rule: Sign in with Apple when Google or GitHub is offered

Guideline 4.8: an app whose sign-in offers a third-party or social login (Google, GitHub) must also
offer an option with Apple's privacy guarantees, which in practice means Sign in with Apple. Email
and password, or our own emailed links, don't count as third-party and need nothing extra.

GitHub sign-in is on at klipstack.com, and the app's sign-in opens the same login page. The app's
sign-in now hides Google and GitHub (done above). The rule in code is generic: in the sign-in of
one of our apps on Apple's platforms (`APPLE_PLATFORM_CLIENTS`), providers show only when Apple is
among them (`offeredIn` in `apps/web/app/lib/provider-sign-in.server.ts`). Once Sign in with Apple
is added, all of them show there together.
