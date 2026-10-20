# Sign-in providers: Google, GitHub and Apple

All are optional. A provider's button appears on `/login`, `/signup` and in Settings when its
client ID and secret are both set (Apple: see [Sign in with Apple](#sign-in-with-apple)).

Klipstack asks each provider who signed in (name, email, whether the email is verified). It calls
no other provider API and does not keep provider tokens. A provider verifies the email address
itself, so on a server without email delivery it is the way to get a verified account.

In this page, `YOUR_DOMAIN` is the host of `APP_URL`, for example `klipstack.example.com`.

Use accounts you control for the server, not personal ones. Store every secret in your password
manager, never in the repository or a chat. The consoles below rename their menus from time to
time: look for the nearest match.

## Google

Google needs three things: a project, a consent screen and a client.

**1. A project.** In [Google Cloud](https://console.cloud.google.com), pick or create a project
for the server in the project picker at the top. Everything below happens inside it.

**2. The consent screen**: what Google shows people when they choose Continue with Google. Google
issues no client until it exists. Open APIs & Services → OAuth consent screen (on newer accounts,
Google Auth Platform → Get started):

- App information: the app's name, and a user support email that people will see.
- Audience: **External** (Internal admits only a Google Workspace organization's own people).
- Contact information: an address where Google writes to you about the app. Accept the policy and
  create it.
- Branding: the home page (`https://YOUR_DOMAIN`), the privacy policy (`https://YOUR_DOMAIN/privacy`),
  the terms (`https://YOUR_DOMAIN/terms`), and `YOUR_DOMAIN` under Authorized domains. Leave out the
  logo at first: with a logo, Google checks the brand before showing it, which takes days. Brand
  verification also needs the domain verified in Google Search Console.
- Data access: add nothing. Klipstack asks for `openid`, `email` and `profile`, which Google
  counts as non-sensitive: no review, no "unverified app" warning, no user cap.
- Audience: **Publish app**, so that it says In production. An app left in Testing admits only
  the test users it lists; everyone else gets an error.

**3. The client**: Clients → Create client (or Credentials → Create credentials → OAuth client ID).

- Application type: Web application. The name is for you only.
- Authorized JavaScript origins: none.
- Authorized redirect URIs: `https://YOUR_DOMAIN/api/auth/callback/google`, exactly: `https`, no
  trailing slash.
- Create, then copy the client ID and the client secret right away: Google may not show the
  secret again.

Then turn it on (below) with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## GitHub

GitHub → your organization or account → Settings → Developer settings → OAuth Apps → New OAuth
App: the app's name, the homepage URL (`https://YOUR_DOMAIN`), and the callback URL
`https://YOUR_DOMAIN/api/auth/callback/github`. Generate a client secret and copy it. The scopes
are GitHub's defaults (`read:user`, `user:email`).

Leave wildcard redirect matching and Device Flow off (Klipstack uses neither). Token expiry can
stay on: no GitHub token is kept. An OAuth App needs nothing else. A GitHub App also works, with
three more settings: Account permissions → Email addresses: Read-only (without it sign-in fails
with `email_not_found`), the webhook set to inactive, and installation allowed for any account.

## Local development

The callback URL must match `APP_URL` exactly. For local development register a second app (or a
second redirect URI on Google) with `http://localhost:5180/api/auth/callback/<provider>` and put
its values in the local `.env`. Never reuse the production secret locally. Apple accepts no
`localhost` address, so Sign in with Apple can't be tried locally.

## Turn a provider on

1. Add the pair to `.env` (`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or `GITHUB_CLIENT_ID`
   and `GITHUB_CLIENT_SECRET`; Apple's four values are below).
2. Recreate the web container. `docker compose restart` keeps the old environment; `up` recreates
   a container whose settings changed. The worker does not read these values.

   ```sh
   docker compose up -d web
   ```

3. Check: `/login` shows the button; a sign-up with a fresh invite creates the account and marks
   the invite used in `/admin`; the login button with an account that does not exist answers "No
   Klipstack account uses that login yet". To use it with an existing account, connect it first
   in Settings → Ways to log in: the provider's email must be the account's.

## Sign in with Apple

Apple needs a paid Apple Developer account and an https `APP_URL`. Everything is in the
[developer account](https://developer.apple.com/account), under Certificates, Identifiers &
Profiles, except the team ID: Membership details shows it.

**1. The App ID.** Apple groups the web's sign-in under an app. With your own build of the iPhone
app, use its App ID; otherwise register one (Identifiers → +, App IDs, App). Open it, tick
**Sign in with Apple** under Capabilities, keep "Enable as a primary App ID", and save. An app
already in the App Store keeps working; its next build carries the capability.

**2. A Services ID**, the identity the web signs in as. Identifiers → +, **Services IDs**:

- Description: the name people may see on Apple's sign-in page, such as your app's name.
- Identifier: reverse-domain and different from the App ID, such as `com.example.web`.
- Register it, open it, tick **Sign in with Apple**, and Configure:
  - Primary App ID: the App ID of step 1.
  - Domains and Subdomains: `YOUR_DOMAIN`, without `https://`.
  - Return URLs: `https://YOUR_DOMAIN/api/auth/callback/apple`, exactly.
- Next, Done, Continue, Save.

**3. A key**, which signs the server's requests to Apple. Keys → +:

- A name for you, such as "Sign in with Apple".
- Tick **Sign in with Apple**, Configure, choose the App ID of step 1, Save.
- Continue, Register, then **Download** the `.p8` file. Apple offers it once: put it in your
  password manager. Note the key ID shown beside it (10 characters).

**4. Email relay.** People may hide their address from you: Apple then gives you one at
`privaterelay.appleid.com` and forwards to it only mail from senders you registered. Under
Services → **Sign in with Apple for Email Communication** → Configure, add the address in
`EMAIL_FROM` and its domain. Apple checks SPF on that mail, which a domain set up with your email
provider (for example Resend) passes. Without this, sign-in links, password resets and the
welcome email never reach those people.

**5. The server's values.** Set all four in `.env`, then recreate the web container as above:

| Variable | Value |
| --- | --- |
| `APPLE_TEAM_ID` | The team ID, from Membership details (10 characters) |
| `APPLE_SERVICES_ID` | The Services ID of step 2 |
| `APPLE_KEY_ID` | The key ID of step 3 |
| `APPLE_PRIVATE_KEY` | The `.p8` file on one line, its line breaks written as `\n` |

This prints the `.p8` file as that one line:

```sh
awk 'NF {sub(/\r$/, ""); printf "%s\\n", $0}' AuthKey_KEYID.p8
```

Set all four, or the server refuses to start rather than hide the button without a word. The
server signs Apple's client secret with the key itself and renews it daily, so nothing expires.
With `APPLE_BUNDLE_ID` also set, the server accepts Apple's sign-in tokens from that iPhone app as
well.

**6. Check.** `/login` shows Continue with Apple, and it opens Apple's page with your
Services ID's sign-in. Connect it to your own account in Settings → Ways to log in, with "Share
My Email" and the Apple ID whose address is your account's, then log out and back in with Apple.

What differs from Google and GitHub:

- Apple sends the person's name only at their first sign-in to your Services ID.
- Someone who hides their address arrives with a new one, so Apple never matches an existing
  account. To connect Apple in Settings, they share their real address with Apple, since it must
  equal the account's. Apple remembers the first choice: someone who hid it first removes the
  app from their Apple ID (Settings → their name → Sign in with Apple on an iPhone) and connects
  again.
- Turning Apple off means emptying `APPLE_SERVICES_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`
  together. Keep `APPLE_TEAM_ID` if your own build of the iPhone app uses it.
- To use another key, create it, replace `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`, recreate the web
  container, then revoke the old key at Apple.

## Turn a provider off, or rotate its secret

- Off: empty the pair and recreate the web container as above. The buttons disappear. Accounts
  keep their provider link and can still disconnect it in Settings. They log in with an emailed
  link or their password meanwhile.
- Rotate: create a new secret at the provider, replace it in `.env`, recreate the web container,
  then delete the old secret at the provider. Sessions are not affected. Sign-ins in flight during
  the restart fail once and work on retry.

## When a sign-in fails

The visitor lands on `/login` or `/signup` with `?error=<code>`:

| Code | Meaning |
| --- | --- |
| `INVITE_REQUIRED` | No account for that identity, and the sign-in carried no usable invite. |
| `account_not_linked` | An account uses that email, and the provider was never connected to it. With an unverified account this is deliberate: see the spec. |
| `email_not_found` | The provider shared no email. On GitHub the user must have a verified primary email. |
| `invalid_code`, `state_mismatch`, others | The exchange with the provider failed: wrong secret, wrong callback URL, or an expired attempt. The web log has an `[auth]` line. |
