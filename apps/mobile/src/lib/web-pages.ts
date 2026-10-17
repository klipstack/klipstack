import { Linking } from "react-native"

/**
 * Opens a page of the Klipstack server in Safari, outside the app. An in-app browser would show
 * the web's own sign-in when it has no session, which offers GitHub without Sign in with Apple
 * (App Review 4.8). Safari also has the reader's web session, and their own way in: an account
 * without a password signs in there with its provider, to delete itself for one. The sign-in sheet
 * (lib/oauth.ts) is the only Klipstack page inside the app.
 */
export function openOnTheWeb(url: string) {
	void Linking.openURL(url)
}
