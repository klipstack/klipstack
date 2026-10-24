# The Safari extension: trying it and publishing it

The browser extension (`apps/extension`) runs in Safari on a Mac as it is. Apple distributes
Safari extensions only inside an app from the App Store, so it ships as a small Mac app,
"Klipstack for Safari", which holds the extension and does nothing else. Apple's
[Safari Web Extension Packager](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect),
in App Store Connect, builds that app from the extension's files. It needs no Xcode, and it gets
testers through TestFlight and readers through App Review, like the iPhone app (`app-store.md`).

Decided: macOS only (iPhone readers save from the app's share sheet), in an app record of its
own, under the team Klipstack SpA.

## The build

```sh
pnpm --filter @klipstack/extension build:safari   # → apps/extension/dist/safari-mv3/
pnpm --filter @klipstack/extension zip:safari     # → apps/extension/dist/klipstackextension-<version>-safari.zip
```

Safari's build is Manifest V3 (the background calls `browser.action`, which V2 lacks) and leaves
out the keys only Firefox reads (`theme_icons`, `browser_specific_settings`). It saves to
https://klipstack.com; `WXT_APP_URL=http://localhost:5180` in front builds one for the dev server,
as for Chrome. The version is `apps/extension/package.json`'s.

## 1. Try it in your Safari

A temporary extension needs no Apple account. Safari removes it when it quits, or after 24 hours.

1. Pull the branch and build: `pnpm install`, then `pnpm --filter @klipstack/extension build:safari`.
2. In Safari, open Safari → Settings → Advanced and tick "Show features for web developers".
3. Open the Developer tab (same window) and tick "Allow unsigned extensions". Safari asks for
   your Mac's password. It unticks itself every time Safari quits.
4. Still in the Developer tab, click "Add Temporary Extension…" and choose the folder
   `apps/extension/dist/safari-mv3`.
5. Safari opens the Extensions tab with Klipstack under "Temporary": tick its box.
6. Sign in to https://klipstack.com in Safari, if you aren't already.
7. Open an article and click the Klipstack button in the toolbar. If the button isn't there, add
   it with View → Customize Toolbar.
8. Safari grants no site to an extension at install. If it asks whether Klipstack may use a
   site, choose "Always Allow on This Website". Then check Settings → Extensions → Klipstack →
   "Edit Websites…": klipstack.com should say Allow. Set it there if it doesn't. Note whether
   Safari asked on its own: readers will go through the same steps.

What to check, since only a real Safari can tell us:

- **The save reaches your account.** A "Saved to Klipstack" notice appears on the page, with
  "Open", and the article is in your Inbox. This is the main risk: the extension saves with
  Safari's klipstack.com sign-in (its cookie), and Safari's privacy protections could keep that
  cookie from the extension's request. "Sign in to Klipstack first" while you are signed in means
  they did. Tell me, with what Settings → Extensions says about klipstack.com.
- **Right-click** on a page and on a link: "Save page to Klipstack" and "Save link to Klipstack".
- **A paywalled or signed-in article** saves in full, as in Chrome.
- **Spanish:** with the Mac in Spanish, the menus say "Guardar página en Klipstack".
- **Errors** show in the extension's console: Develop → Web Extension Background Content →
  Klipstack.

To try a change, build again, then click "Reload" beside the extension in Settings → Extensions.

## 2. Publish it

Each step says where to click. The ones in App Store Connect need the Account Holder or Admin
role.

### a. Register the app's identifier

1. https://developer.apple.com/account → Certificates, IDs & Profiles → Identifiers → "+".
2. App IDs → App → Continue.
3. Description "Klipstack for Safari", Bundle ID Explicit: `com.klipstack.safari`. No
   capabilities. Continue → Register.

### b. Create the app record

1. https://appstoreconnect.apple.com → Apps → "+" → New App.
2. Platforms: **macOS** only.
3. Name: **Klipstack for Safari**. ("Klipstack" is the iPhone app's, and names are unique in the
   App Store.)
4. Primary language: English (U.S.). Bundle ID: `com.klipstack.safari`. SKU: `klipstack-safari`.
   User access: Full Access.
5. Create.

### c. Upload the extension

1. Build the zip: `pnpm --filter @klipstack/extension zip:safari`.
2. App Store Connect → Users and Access → the Xcode Cloud tab → Safari Web Extension Packager →
   Upload. If it asks you to accept Xcode Cloud's terms first, accept them.
3. Choose `apps/extension/dist/klipstackextension-0.1.0-safari.zip`, and the app
   Klipstack for Safari.
4. Wait until its status there says it's done (minutes). It reports what Safari doesn't support:
   send me the report, even when it passes.
5. If it says an identifier is missing for the extension inside the app (something like
   `com.klipstack.safari.Extension`), register that one as in (a) and upload again.

Packaging uses the Xcode Cloud hours that come with the membership (25 a month). An upload takes
a few minutes of them.

### d. Test it with TestFlight

1. The app → TestFlight. The build shows up there once processed (it can take half an hour).
2. If it asks about encryption ("Missing Compliance"): the extension only uses HTTPS, so answer
   that it uses no encryption besides the exemptions (standard encryption built into the OS).
3. Internal Testing → "+" → a group with yourself → add the build.
4. On your Mac, install TestFlight from the Mac App Store, accept the invite, install
   Klipstack for Safari, and open it once.
5. Safari → Settings → Extensions: tick Klipstack, and repeat the checks of section 1. Remove the
   temporary one first, so you test this one.

### e. The App Store page

App → App Store tab, in the macOS version (1.0 Prepare for Submission):

- **Screenshots:** the Chrome Web Store's, which are 1280×800 and show no Chrome:
  `brand/chrome-web-store/screenshot-1-en.png` to `-3-en.png` (and the `-es` ones for Spanish).
- **Promotional text** (optional), **Description** and **Keywords:** the description is the
  Chrome Web Store's (`brand/chrome-web-store/README.md`, "Store listing"), English and Spanish.
  Keywords: `read later,save,articles,highlights,reading,bookmarks`.
- **Support URL:** https://klipstack.com/support. **Marketing URL:** https://klipstack.com/extension.
- **Copyright:** 2026 Klipstack SpA.
- **App Review information:** sign-up is by invite, so create an account for the reviewer and
  give its email and password. Notes: "Klipstack for Safari only installs a Safari extension.
  Open it, enable Klipstack in Safari → Settings → Extensions, allow it on klipstack.com, sign in
  at klipstack.com, open any article and click the Klipstack toolbar button. A 'Saved to
  Klipstack' notice appears, and the article is in the library."
- **Build:** the TestFlight build that passed your checks.

App Information (left column):

- **Category:** Productivity. **Content rights:** no third-party content.
- **Age rating:** the questionnaire as for the iPhone app (`app-store.md`, "Age rating"): the
  extension saves any page, so "unrestricted web access" is the cautious "Yes".
- **Privacy Policy URL:** https://klipstack.com/privacy (it already describes the extension).

App Privacy (left column), "Get Started": data is collected, none used for tracking. Declare:

| Apple's category | What it is | Linked | Purpose |
| --- | --- | --- | --- |
| User Content → Other User Content | The pages you save | Yes | App Functionality |
| Browsing History | The address of each page you save | Yes | App Functionality |

The extension itself reads no account details, so Name, Email and User ID are not declared here:
the browser's sign-in to klipstack.com carries them. If App Review disagrees, declaring them as
the iPhone app does (App Functionality, linked) is harmless.

Pricing and Availability: Free, all countries.

### f. Submit

App Store tab → Add for Review → Submit. Review takes a day or two. Once it is released:

1. Copy the app's link from App Store Connect (App Information → "View on App Store"), like
   `https://apps.apple.com/app/id…`.
2. Ask me to set it as `SAFARI_STORE` in `packages/email/src/extension-url.ts`. Then
   klipstack.com/extension offers it instead of "Coming soon", and Safari on a Mac gets the
   extension in Getting started and on the empty Home and Inbox. In the same change, the landing
   page's FAQ and "Save from anywhere" should say Safari too.

### Updating it

Raise `version` in `apps/extension/package.json`, build the zip again, upload it as in (c), and
submit the new build as a new version. The Chrome and Safari versions can move together.
