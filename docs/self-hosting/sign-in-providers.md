# Sign-in providers: Google, GitHub and Apple

All are optional. A provider's button appears on `/login`, `/signup` and in Settings when its
client ID and secret are both set (Apple: see [Sign in with Apple](#sign-in-with-apple)).

Klipstack asks each provider who signed in (name, email, whether the email is verified). It calls
no other provider API and does not keep provider tokens. A provider verifies the email address
itself, so on a server without email delivery it is the way to get a verified account.

In this page, `YOUR_DOMAIN` is the host of `APP_URL`, for example `klipstack.example.com`.

## Register the apps

Use an account you control for the server, not a personal one. Store the client secrets in your
password manager.

| | Google | GitHub |
| --- | --- | --- |
| Where | Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application) | GitHub → your organization or account → Settings → Developer settings → OAuth Apps |
| Redirect / callback URL | `https://YOUR_DOMAIN/api/auth/callback/google` | `https://YOUR_DOMAIN/api/auth/callback/github` |
| Scopes | `openid`, `email`, `profile` (the defaults) | `read:user`, `user:email` (the defaults) |
| Consent screen | App name, support email, your domain. Publish it: a "Testing" app only admits listed test users. These scopes are not sensitive: no "unverified app" warning and no user cap apply without verification. Brand verification only adds the app name and logo to Google's screen. It needs a homepage that describes the app, a privacy policy linked from it, and the domain verified in Search Console. The landing page links the privacy policy at `/privacy`. | App name, homepage URL. |

GitHub settings: leave wildcard redirect matching and Device Flow off (Klipstack uses neither).
Token expiry can stay on: no GitHub token is kept. An OAuth App needs nothing else. A GitHub App
also works, with three more settings: Account permissions → Email addresses: Read-only (without it
sign-in fails with `email_not_found`), the webhook set to inactive, and installation allowed for
any account.

The callback URL must match `APP_URL` exactly. For local development register a second app (or a
second redirect URI on Google) with `http://localhost:5180/api/auth/callback/<provider>` and put
its values in the local `.env`. Never reuse the production secret locally.

## Turn a provider on

1. Add the pair to `.env` (`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or `GITHUB_CLIENT_ID`
   and `GITHUB_CLIENT_SECRET`).
2. Recreate the web container. `docker compose restart` keeps the old environment; `up` recreates
   a container whose settings changed. The worker does not read these values.

   ```sh
   docker compose up -d web
   ```

3. Check: `/login` shows the button; a sign-up with a fresh invite creates the account and marks
   the invite used in `/admin`; the login button with an account that does not exist answers "No
   Klipstack account uses that login yet".

## Sign in with Apple

Apple needs a paid Apple Developer account, and works only on an https `APP_URL`: Apple accepts
no `localhost` return URL, so a local server can't try it. In the developer account, under
Certificates, Identifiers & Profiles:

1. **An App ID.** Apple groups the web's sign-in under one. With your own build of the iPhone app,
   use its App ID; otherwise create one (Identifiers → +, App IDs). Turn on Sign in with Apple in
   its capabilities.
2. **A Services ID**, the identity the web signs in as: Identifiers → +, Services IDs, for example
   `com.example.web`. Turn on Sign in with Apple and configure it: the App ID above as primary,
   `YOUR_DOMAIN` under Domains, and `https://YOUR_DOMAIN/api/auth/callback/apple` under Return
   URLs.
3. **A key**: Keys → +, Sign in with Apple, configured with the same App ID. Download the `.p8`
   file. Apple offers it once: keep it in your password manager. Note its key ID.
4. **Email relay.** People may hide their address from you, and Apple gives you one at
   `privaterelay.appleid.com` instead. Apple forwards mail to it only from senders you register:
   under Services, Sign in with Apple for Email Communication, add the domain of `EMAIL_FROM`.
   Without it, sign-in links and password resets never reach those people.

Then set four values and recreate the web container:

| Variable | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Your team ID (Membership details, 10 characters) |
| `APPLE_SERVICES_ID` | The Services ID |
| `APPLE_KEY_ID` | The key's ID (10 characters) |
| `APPLE_PRIVATE_KEY` | The `.p8` file on one line: `awk 'NF {printf "%s\\n", $0}' AuthKey_KEYID.p8` prints it |

All four, or the server refuses to start. The server signs Apple's client secret with the key
itself and renews it daily, so nothing expires. With `APPLE_BUNDLE_ID` also set, the server
accepts Apple's sign-in tokens from that iPhone app as well.

What differs from Google and GitHub:

- Apple sends the person's name only at their first sign-in to your Services ID.
- Someone who hides their address arrives with a new one, so Apple never matches an existing
  account. To connect Apple in Settings, they share their real address with Apple, since it must
  equal the account's.
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
