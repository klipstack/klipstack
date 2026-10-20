# Klipstack mobile app

Expo (React Native) app for iOS. The repository's root `AGENTS.md` applies too.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. Before writing code that touches an Expo or React
Native API:

1. Read the major version of `expo` in `package.json`.
2. Fetch the matching docs: `https://docs.expo.dev/versions/v<major>.0.0/`.
3. For anything else, start at https://docs.expo.dev/llms.txt. Never answer from memory.

## Commands

Run from `apps/mobile`. Metro runs on port 8082, leaving 8081 free for other React Native projects.
Never set `CI=1` for Metro: it turns off file watching, and the app keeps running old code.
The app's `console.log` output shows in Metro's output.

```sh
pnpm expo install <package>  # Always: it picks versions that match the SDK
pnpm ios                     # Prebuild, build and run in the iOS simulator
pnpm ios:release             # A release build in the simulator
pnpm ios:device              # A release build on the connected iPhone, signed for development
pnpm ios:testflight          # A release build, uploaded to App Store Connect for TestFlight
pnpm start                   # Metro only, for an app that is already installed
pnpm typecheck
pnpm test                    # Vitest, for the pure code in src/lib and src/page (no React Native imports)
pnpm build:page              # Bundle src/page into src/lib/reader-page.generated.ts, after changing it
pnpm dlx expo-doctor         # Diagnose dependency and config problems
```

## Layout

- `src/app/`: Expo Router screens. Every file is a route. Keep other code outside.
  - `(tabs)/`: the native tab bar (`unstable-native-tabs` in SDK 57). Each tab is a folder with
    its own stack (`_layout.tsx`, via `TabStack`); Home is the `(home)` group, so it is `/`.
    `library/` holds the places (`index.tsx`) and each place's list (Inbox, Starred, Archive,
    Trash, `tags/`, `topics/`, `saved/`); the tab opens on Inbox, pushed by `index.tsx` onto its own stack.
  - `read/[id].tsx`: the reader, on the root stack over the tabs.
  - `save.tsx`: the sheet to save a link, from the + button on Home and Inbox.
  - `discover.tsx`: the starter texts (`GET /starter-texts`), the guide and shelves by topic, as
    the web's Discover, from the Library and Home's empty state, which offers a few itself.
  - `account/`: Account, a sheet with its own stack, from the header's account button: who is
    signed in, usage (`GET /usage`), appearance, Voices, the library's export, links to the web,
    signing out and deleting the account (`POST /account/delete`, which may ask to sign in again).
- `src/components/`: pieces shared by screens (the article row, a library list, the tab stack).
- `src/lib/`: auth, API client, storage, and the reader's pure code (tested with Vitest).
- `src/page/`: the reader page's script, which runs in the WebView, not in React Native: DOM
  code with `@klipstack/anchor`, tested in jsdom. `pnpm build:page` bundles it into
  `src/lib/reader-page.generated.ts` (committed; never edit it). A test fails while the bundle is
  stale. `messages.ts` holds what the app and the page tell each other.
- `modules/`: local native modules: `klip-lookup` (the dictionary sheet), `klip-pasteboard`
  (whether the clipboard holds a link, without reading it, and the system's Paste button),
  `klip-speech` (reading aloud; see its README) and `klip-dictation` (dictating a note, recognized
  on the device; see its README).
- `targets/share/`: the iOS share extension, in Swift. `@bacons/apple-targets` links it into
  the Xcode project at prebuild.
- `targets/widget/`: the home screen's "Next up" widget, in Swift: Home's big card (and, in the
  large size, two more after it), loaded with the shared session. `src/lib/widget.ts` reloads
  it; a tap opens `klipstack://read/<id>`.
- `plugins/with-extension-settings.js`: what `@bacons/apple-targets` has no option for: the
  extensions run on the app's devices (iPhone only while `ios.supportsTablet` is false), and a
  Release build drops the extensions' `NSAllowsLocalNetworking` (the dev server only).
- `app.json` holds the privacy manifest (`ios.privacyManifests`): the required-reason APIs of the
  app and its pods, and the data it collects. A new native dependency may need its reasons added:
  check its `PrivacyInfo.xcprivacy`, and `ios/Klipstack/PrivacyInfo.xcprivacy` after a prebuild.
  Apple also refuses a build whose code (the pods' included) references a protected API without
  its purpose string in `ios.infoPlist`, even if the app never calls it: `NSPhotoLibraryUsageDescription`
  is there for expo-image and expo-file-system. The refusal comes by email (ITMS-90683), after the
  upload; the build never shows in TestFlight.
- `ios/` and `android/` are generated (`expo prebuild`) and ignored. Never edit them. Change
  `app.json`, a config plugin, or `targets/` instead, then run `pnpm ios` again.
  After a release build (`pnpm ios:device`), a development build can fail to link
  (`RCTPackagerConnection` not found): delete `ios/` and run `pnpm ios` again.
- `expo-build-properties` sets `ios.enableSceneSupport` in `app.json`: iOS 27 stops an app built
  with Xcode 27 at launch unless it uses the scene life cycle. SDK 58 does this by default; drop
  the setting then.
- `app.config.ts` adds what must stay out of the repo to `app.json`: the Apple team that signs
  device builds, from `APPLE_TEAM_ID` in `apps/mobile/.env.local` (ignored). Simulator builds
  need none.

## Which server

- **Development builds** (`pnpm ios`) talk to the local dev server, `http://localhost:5180`, and
  load their JavaScript from Metro.
- **Release builds** (`pnpm ios:release`) talk to `https://klipstack.com` and carry their
  JavaScript: no Metro, no Mac needed. The phone runs these.
- `EXPO_PUBLIC_API_URL` overrides both (`src/lib/config.ts`). A stored session for a different
  server is dropped at launch, so switching builds means signing in again.

## Signing in without a password (development)

A development build can skip the OAuth sign-in: put an API key for a dev-server account in
`.env.local` as `EXPO_PUBLIC_API_TOKEN`, then restart Metro.

```sh
pnpm --filter @klipstack/web api-key <email> mobile-simulator   # prints klip_…
```

The app stores it as the session (so the share extension has it too) and never refreshes it.
Release builds ignore it. Agents need this to use the simulator: they can't type passwords.

Restart Metro with `pnpm start --clear` after changing the key: without `--clear` the app can keep
the old one. Setting `EXPO_PUBLIC_API_TOKEN` on the command line instead of in `.env.local` does
not reach the app.

The reader's AI (the brief, Explain, Define, Ask, the chat) and deleting the account answer only
tokens the server issued to this app (`IN_APP_AI_CLIENTS` and `ACCOUNT_DELETION_CLIENTS` in
`packages/api-contract/src/auth.ts`), not API keys: signed in with a key, the reader shows no AI.
For those, sign the app in with an app token instead: `dev-account` issues one for a throwaway
account (below).

Before the account's first question, the reader asks whether its questions may go to Anthropic
(`AiConsentSheet`). The answer is kept on the account (`PUT /ai/consent`, `consentedAt` in
`GET /ai`) and changed in Account. A throwaway account starts without it.

```sh
pnpm --filter @klipstack/web dev-account create --feature ai --app-token
# … app token EXPO_PUBLIC_APP_REFRESH_TOKEN=…
pnpm --filter @klipstack/web dev-account app-token <email>   # a new one, for an existing account
```

It runs the app's real OAuth sign-in (consent and all) in process, so the token is a
`klipstack-mobile` refresh token. Put the line in `.env.local` and restart Metro with `pnpm start
--clear`. It wins over `EXPO_PUBLIC_API_TOKEN`. The app starts its session from it once: the server
rotates it at the first refresh, and the app keeps the new one across launches. After signing out,
or to switch accounts, issue a new one. Run `pnpm dev` with `AI_FAKE=1` to answer with fixed text
instead of calling the AI provider.

- The token is for the dev server at `APP_URL`: not with `EXPO_PUBLIC_API_URL` set elsewhere.
- Deleting the account needs a sign-in from the last 30 minutes. Later, the app asks to sign in
  again, on its sign-in screen in a sheet: the throwaway's password is `local-throwaway-only`.

## Testing on a throwaway account

Don't change the demo account (`reader@demo.klipstack.test`) to test: other agents and `pnpm
orb:app` rely on what it holds. Make a throwaway account on the local dev database instead:

```sh
pnpm --filter @klipstack/web dev-account create --articles 20 --feature topics
# prints the address, the password (for the web), and an API key (klip_…);
# with --app-token, also a refresh token for the app (see above)
pnpm --filter @klipstack/web dev-account list
pnpm --filter @klipstack/web dev-account delete <email>   # or: delete --all
```

It copies the demo account's newest ready articles, unread and in the Inbox, with their own copies
of the images, so deleting it never touches the demo's. It refuses any database but a local one,
and `delete` only touches `@throwaway.klipstack.test` accounts it made. Put the key in `.env.local`
as above, restart Metro with `--clear`, and put your own key back when done. Delete the account
before you finish. Images are copied within `STORAGE_FS_ROOT`, one per checkout, so in a new worktree
the articles come without them. To have them, set `STORAGE_FS_ROOT` to the storage of the checkout
that seeded the demo for both the script and `pnpm dev`: the server reads images from its own root.

## Tapping and swiping in the simulator

Under Xcode 27, AXe's taps and swipes do nothing. `tools/ui-driver/run.sh` does them with
XCUITest: tap by label or point, long-press, drag, type, and take screenshots, on the development
build already running, and type into the sign-in sheet's web page (`webtype`, `webtap`). See
`tools/ui-driver/README.md`. If that sheet or another in-app browser stays blank, `pkill -f
SafariViewService` and try again. Check the server's state after a step (the API or the
database), not only the screenshot.

## Sign-in and the share extension

- The app signs in on its own screen (`src/components/sign-in-form.tsx`, `src/lib/oauth.ts`):
  Sign in with Apple in iOS's sheet (`expo-apple-authentication`), Google and GitHub, the email
  with a password or an emailed code. It shows only what `GET /app/sign-in` lists. Each way ends
  in an OAuth authorization code (+ PKCE) for the first-party client `klipstack-mobile`, which has
  no consent screen: the password, the code and Apple's tokens through `POST /app/sign-in`, Google
  and GitHub in a private sign-in sheet at `/app/sign-in/<provider>`, which goes straight to the
  provider and back to the app. The server's side is `apps/web/app/lib/app-sign-in.server.ts`.
  Emailed codes print in the dev server's output. "Create an account" opens
  `src/app/sign-up.tsx`: the invite (unless the server's sign-up is open), then Apple, Google or
  GitHub, or a name, email and password confirmed by an emailed code (`/app/sign-up`,
  `app-sign-up.server.ts`). In the simulator the password field shows iOS's strong-password
  overlay, which has no keychain there: to type a password in a test, set its `textContentType` to
  `none` for the run. On an https server
  the code from the sign-in sheet comes back through the
  universal link `<server>/app/oauth/callback`, which needs the paid team's signature, the
  Associated Domains in `app.json`, and iOS 17.4 (the app's minimum). Against the http dev server
  it comes back through the custom scheme `com.klipstack.app:` (`mobileRedirectUri`). Associated
  Domains name klipstack.com only: a build pointed at another https server can't finish signing in.
- Builds from before that screen sign in on the web's pages in a browser sheet; there the web
  offers no provider button (Apple, Google, GitHub): a trip to a provider would leave the app's
  request behind (`APPLE_PLATFORM_CLIENTS` in `packages/api-contract/src/auth.ts`). The app offers
  them itself, Sign in with Apple among them (App Review 4.8).
- A real Sign in with Apple needs a build signed by the paid team (the capability is in `app.json`,
  `usesAppleSignIn`) and a server with Apple and `APPLE_BUNDLE_ID` set: on the dev server it
  can't finish. Deleting the account revokes it at Apple (the server keeps Apple's token for that).
- Every other Klipstack page opens in Safari (`openOnTheWeb`, `src/lib/web-pages.ts`), never in an
  in-app browser: signed out there, the web's own login would show GitHub inside the app. Lint
  refuses `expo-web-browser` in `src/`.
- It keeps the session (API URL, tokens) as one JSON keychain item in the app group
  `group.com.klipstack`. The share extension and the widget read and refresh the same item;
  only the app and the share extension delete it.
- Every API request sends `X-Klipstack-Client: ios/<version>`. The server answers `426` when the
  version is too old; the app and the extension then ask the user to update.
