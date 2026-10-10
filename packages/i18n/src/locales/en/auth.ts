export default {
	email: "Email",
	password: "Password",
	name: "Name",
	inviteCode: "Invite code",
	login: {
		title: "Log in",
		submit: "Log in",
		withMagicLink: "Email me a login link instead",
		forgotPassword: "Forgot your password?",
		noAccount: "No account yet?",
		signup: "Sign up",
		invalid: "Invalid email or password.",
		oauthNote: "Log in to continue connecting an app to your Klipstack account.",
	},
	signup: {
		title: "Create your account",
		submit: "Create account",
		agree: "By creating an account, you accept the",
		terms: "terms of use",
		haveAccount: "Already have an account?",
		login: "Log in",
		inviteRequired: "Klipstack is invite-only for now. Enter the code you received.",
		invalidInvite: "That invite code is not valid or has already been used.",
		emailTaken: "An account with this email already exists.",
		passwordTooShort: "Password must be at least {{min}} characters.",
		noCode: "No code?",
		requestInvite: "Request an invite",
	},
	requestInvite: {
		title: "Request an invite",
		description:
			"Klipstack is invite-only for now. Leave your email, and we will send you an invite when there is room.",
		note: "What would you use Klipstack for? (optional)",
		noteHint: "Up to {{max}} characters.",
		noteTooLong: "Keep it under {{max}} characters.",
		trap: "Leave this empty",
		submit: "Request an invite",
		receivedTitle: "Thanks",
		received:
			"If there is room, we will email you an invite code. If you already have an account, just log in.",
		expired: "This form was open for too long. Please send it again.",
		full: "The wait list is full for now. Please try again later.",
		backHome: "Back to Klipstack",
		haveCode: "Have an invite code?",
		signup: "Sign up",
		email: {
			subject: "Your Klipstack invite",
			body: "You asked to try Klipstack. Your invite code is {{code}}. It works for {{days}} days.",
			cta: "Create my account",
			footer: "If you did not ask for this, you can ignore this email.",
		},
	},
	providers: {
		or: "or",
		continueWith: "Continue with {{provider}}",
		errors: {
			inviteRequired:
				"No Klipstack account uses that login yet. Sign up with an invite code to create one.",
			notLinked:
				"A Klipstack account already uses that email address. Log in another way, then connect this account in Settings.",
			noEmail: "That account shared no email address. Klipstack needs one.",
			failed: "We could not log you in that way. Please try again.",
		},
	},
	magicLink: {
		title: "Log in with a link",
		description: "We will email you a one-time link. No password needed.",
		submit: "Send me a link",
		sentTitle: "Check your inbox",
		sentDescription:
			"If an account exists for {{email}}, a login link is on its way. It expires in {{minutes}} minutes.",
		backToLogin: "Back to log in",
		emailSubject: "Your Klipstack login link",
		emailBody: "Click the link below to log in to Klipstack. It expires in {{minutes}} minutes.",
		emailCta: "Log in to Klipstack",
		emailIgnore: "If you did not request this, you can ignore this email.",
	},
	signupLink: {
		passwordHint: "Optional. Leave it empty and we will email you a link to create your account.",
		sentTitle: "Check your inbox",
		sentDescription:
			"We sent a link to {{email}}. Open it to continue. It expires in {{minutes}} minutes.",
		failed: "We could not send the email. Please try again.",
		confirmTitle: "Create your account",
		confirmDescription:
			"This creates your Klipstack account for {{email}}. You will log in with links sent to this address. You can add a password later.",
		expiredTitle: "Link expired",
		expired: "This link has expired or has already been used.",
		inviteTitle: "Invite no longer valid",
		invite:
			"The invite code for this link was used or has expired. Sign up again with another code.",
		existsTitle: "You already have an account",
		exists: "An account for this address already exists. Log in instead.",
		startAgain: "Sign up again",
		emailSubject: "Create your Klipstack account",
		emailBody:
			"Click the link below to finish creating your Klipstack account. It expires in {{minutes}} minutes.",
		emailCta: "Create my account",
		emailIgnore: "If you did not ask for this, you can ignore this email. No account is created.",
	},
	resetPassword: {
		requestTitle: "Reset your password",
		requestDescription: "We will email you a link to choose a new password.",
		requestSubmit: "Send reset link",
		sentTitle: "Check your inbox",
		sentDescription:
			"If an account exists for {{email}}, a reset link is on its way. It expires in {{minutes}} minutes.",
		title: "Choose a new password",
		description: "This signs you out on every device.",
		newPassword: "New password",
		submit: "Save password",
		done: "Password saved. Log in with your new password.",
		expiredTitle: "Link expired",
		expired: "This link has expired or has already been used.",
		requestAgain: "Request a new link",
		emailSubject: "Reset your Klipstack password",
		emailBody:
			"Click the link below to choose a new password. It expires in {{minutes}} minutes. Saving the new password signs you out on every device.",
		emailCta: "Choose a new password",
		emailIgnore:
			"If you did not request this, you can ignore this email. Your password stays the same.",
	},
	verification: {
		title: "Verify your email address",
		description: "{{email}} is not verified yet. Verify it to create API keys and connect apps.",
		instructions:
			"Open the link in a browser where you are logged in. Your password and sessions stay as they are.",
		loginNote:
			"Log in with your password to finish verifying your email. Your password stays as it is.",
		send: "Send verification email",
		resend: "Resend verification email",
		sending: "Sending…",
		sent: "Check {{email}} for your verification link. It expires in {{minutes}} minutes. Check your spam folder if it does not arrive.",
		verified: "Email verified",
		unavailable:
			"Verification emails are currently unavailable. Please try again later or contact the server owner.",
		failed: "We could not send the email. Please try again.",
		limited: "Too many requests. Try again in {{minutes}} minutes.",
		expired: "This link has expired or is not valid. Request a new verification email.",
		wrongAccount:
			"That link verifies another account. Log in to that account, then open the link again.",
		emailSubject: "Verify your Klipstack email",
		emailBody:
			"Confirm that this address is yours. The link expires in {{minutes}} minutes. Open it in a browser where you are logged in to Klipstack, or log in with your password when asked.",
		emailCta: "Verify email",
		emailIgnore:
			"If you did not create a Klipstack account, you can ignore this email. The link does nothing without the account's password.",
		loginEmailBody:
			"Confirm your email address and log in to Klipstack. This link expires in {{minutes}} minutes. For your security, logging in this way signs out older sessions and removes your password. You can set a new password from the login page.",
		loginEmailCta: "Verify email and log in",
	},
	oauth: {
		title: "Connect an app",
		intro: "{{app}} wants to access your Klipstack account.",
		identifiedBy: "Identified by {{host}}.",
		unverified:
			"Klipstack has not verified this app. Only allow it if you just started connecting it.",
		firstPartyCli: "Only allow this if you just ran {{command}} on your computer.",
		firstPartyMobile: "Only allow this if you just tapped Sign in in the Klipstack app.",
		scopesTitle: "It will be able to:",
		redirectsTo: "You will return to {{target}}.",
		revokeHint: "You can disconnect it at any time in Settings.",
		allow: "Allow",
		deny: "Deny",
		invalid: "This request is invalid or has expired. Start again from the app.",
		signedInAs: "Signed in as",
		switchAccount: "Use another account",
		signInAgain:
			"You signed in more than 30 minutes ago. Log in again to connect a new app: a session left open elsewhere cannot connect one.",
		signInAgainButton: "Log in again",
		optionalHint: "Clear the checkbox to allow reading only.",
		identity: {
			name: "Confirm it is you and see your name",
			email: "Confirm it is you and see your email address",
			nameAndEmail: "Confirm it is you and see your name and email address",
		},
		scopes: {
			openid: "Confirm it is you",
			profile: "See your name",
			email: "See your email address",
			offline_access: "Stay connected until you disconnect it",
			library_read: "Read your library: saved articles, highlights and notes",
			library_write:
				"Change your library: save articles, archive, star and rename them, edit notes and highlights, and move articles to the trash",
		},
	},
	validation: {
		emailInvalid: "Enter a valid email address.",
		required: "This field is required.",
	},
}
