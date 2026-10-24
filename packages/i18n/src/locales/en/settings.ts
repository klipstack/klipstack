export default {
	title: "Settings",
	nav: {
		general: "General",
		connections: "Connections",
		data: "Data",
	},
	profile: {
		title: "Profile",
		description: "Your name and the language Klipstack uses.",
		saved: "Settings saved.",
	},
	appearance: {
		title: "Appearance",
		description: "Follow your device's light or dark setting, or force one.",
	},
	shortcuts: {
		title: "Keyboard shortcuts",
		description:
			"Single keys act on articles: S stars, E archives, # deletes, J and K move. Turn them off if you use speech input or a screen reader. Enter, the arrow keys and Escape keep working.",
		singleKey: "Single-key shortcuts",
	},
	features: {
		title: "Features",
		description: "Turn parts of Klipstack on or off for your account.",
		ai: {
			title: "AI answers",
			label: "Ask AI while reading",
			description:
				"Ask about a passage, chat with an article and get a summary, answered by AI. Turned off, the answers you already have stay, to read and delete.",
		},
		editions: {
			title: "Editions",
			label: "Make editions",
			description:
				"Gather what was worth reading into a public page you can share. Turned off, nothing is deleted, and the editions you published stay public.",
		},
		feeds: {
			title: "Feeds",
			label: "Follow sites and blogs",
			description:
				"New posts from the sites you follow, to save the ones worth reading. Turned off, nothing is deleted: the sites you follow are kept for when you turn it back on.",
		},
		topics: {
			title: "Topics",
			label: "Sort my library into topics",
			description:
				"Topics proposed from your library and kept up to date. Article text goes to AI to sort it.",
			confirm: "Turning topics off deletes them, and where each article was.",
			turnOff: "Turn off and delete",
			keep: "Keep them",
			open: "Open Topics",
		},
	},
	account: {
		title: "Account",
		signInTitle: "Email and login",
		email: "Signed in as {{email}}",
	},
	twoFactor: {
		title: "Two-factor authentication",
		description:
			"Every new sign-in also asks for a code from an authenticator app on your phone, such as 1Password, Google Authenticator or Authy.",
		on: "On. Every new sign-in asks for a code from your authenticator app.",
		password: "Password",
		start: "Set up",
		verifyFirst: "Verify your email first.",
		scan: "1. Scan this code with your authenticator app.",
		qrAlt: "QR code that adds Klipstack to an authenticator app",
		manual: "Can't scan it? Enter this key in the app instead:",
		backupTitle: "2. Save your backup codes",
		backupHint:
			"If you lose your phone, each of these codes signs you in once. Keep them somewhere apart from your phone: they are not shown again.",
		confirmTitle: "3. Enter the code the app shows",
		code: "Code",
		confirm: "Turn on",
		enabled: "Two-factor authentication is on. Your other sessions were signed out.",
		turnOffHint: "To turn it off, enter a code from your authenticator app, or a backup code.",
		turnOff: "Turn off",
		disabled: "Two-factor authentication is off.",
		wrongPassword: "That password is not right.",
		wrongCode: "That code is not right.",
		limited: "Too many attempts. Try again later.",
		expired: "This setup is no longer open. Start again.",
	},
	signIn: {
		title: "Ways to log in",
		description: "Add a password or connect an account you already use.",
		descriptionWithLinks:
			"You can always log in with a link sent to your email. Add a password or connect an account you already use.",
		verifyFirst: "Verify your email address before you add a password or connect an account.",
		currentPassword: "Current password",
		newPassword: "New password",
		setHint: "You have no password yet.",
		changeHint: "Changing it signs you out on your other devices.",
		setPassword: "Set password",
		changePassword: "Change password",
		passwordSaved: "Password saved.",
		wrongPassword: "That is not your current password.",
		badLength: "Use at least {{min}} characters.",
		limited: "Too many attempts. Try again later.",
		failed: "That did not work. Please try again.",
		connected: "Connected",
		connect: "Connect",
		disconnect: "Disconnect",
		connectNamed: "Connect {{provider}}",
		disconnectNamed: "Disconnect {{provider}}",
		lastMethod: "This is your only way to log in. Add a password before you disconnect it.",
		errors: {
			emailMismatch:
				"That account uses another email address. Connect one that uses this account's address.",
			linkedElsewhere: "That account is already connected to another Klipstack account.",
			failed: "We could not connect that account. Please try again.",
		},
	},
	capture: {
		title: "Save from anywhere",
		extension: {
			title: "Browser extension",
			description:
				"One click saves the page exactly as you see it, including articles behind a login or paywall. Install it in a browser where you are signed in to Klipstack.",
			install: "Get the extension",
		},
		bookmarklet: {
			title: "Bookmarklet",
			description:
				"Drag this to your bookmarks bar. It opens a confirmation form in Klipstack with the current page's address (open web only).",
			label: "Save to Klipstack",
		},
	},
	connectedApps: {
		title: "Connected apps",
		copy: "Copy",
		copied: "Copied",
		description: "Apps you allowed to access your account, such as AI assistants.",
		mcpHint:
			"To connect an AI assistant, add Klipstack to it as a remote MCP server with this URL:",
		promptHint: "Or copy a prompt into the assistant: it adds Klipstack itself, or tells you how.",
		empty: "No connected apps.",
		connectedOn: "Connected {{date}}",
		disconnect: "Disconnect",
		disconnectConfirm: "Disconnect this app? It will lose access to your account.",
	},
	usage: {
		title: "Usage",
		description: "Every account has the same limits. Monthly counts start over on {{date}}.",
		saves: "Articles saved this month",
		storage: "Storage",
		feeds: "Feeds followed",
		editions: "Editions published this month",
		shares: "Highlights shared this month",
		ai: "AI questions this month",
		count: "{{used}} of {{max}}",
		megabytes: "{{used}} MB of {{max}} MB",
	},
	data: {
		title: "Your data",
		description:
			"Download everything: one Markdown file per article with its highlights, plus a JSON bundle.",
		zip: "Download .zip (Markdown + JSON)",
		json: "Download .json",
	},
	about: {
		title: "About",
		description: "The version of the app this page is running, and the terms it runs under.",
		update: "A new version is ready — reload",
	},
	danger: {
		title: "Delete account",
		description:
			"Deletes your account, every saved article, highlight and image. This cannot be undone.",
		confirmLabel: "Type your email to confirm",
		submit: "Delete my account",
		mismatch: "The email does not match.",
	},
	reauth: {
		message:
			"You signed in more than 30 minutes ago. Log in again to do this: a session left open elsewhere cannot.",
		button: "Log in again",
		passwordMessage:
			"You signed in more than 30 minutes ago. Confirm it's you with your password to do this: a session left open elsewhere cannot.",
		password: "Password",
		confirm: "Confirm",
		confirmed: "Confirmed. Try it again now.",
		wrongPassword: "That password is not right.",
		limited: "Too many attempts. Try again later.",
		code: "Code from your authenticator app",
		codeHint: "Two-factor authentication is on: enter the 6-digit code, or a backup code.",
		wrongCode: "That code is not right.",
	},
}
