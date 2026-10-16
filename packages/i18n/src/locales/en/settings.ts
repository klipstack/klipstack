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
	account: {
		title: "Account",
		signInTitle: "Email and login",
		email: "Signed in as {{email}}",
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
		shortcut: {
			title: "iOS / macOS Shortcut",
			description:
				"iOS has no share target for web apps, so a Shortcut is how the share sheet reaches Klipstack. Build one that accepts Safari web pages and URLs:",
			step1:
				"Run JavaScript on Web Page (Safari share sheet only): completion(document.documentElement.outerHTML)",
			step2: "Get contents of URL: POST {{url}}",
			step3: "Headers: Authorization = Bearer <your API key>, Content-Type = application/json",
			step4: "Request body (JSON): url = Shortcut Input, html = result of step 1",
			note: "Step 1 captures the page as you see it, so articles behind a login or paywall work. When sharing from other apps, skip it and send only the url.",
		},
	},
	apiKeys: {
		verificationRequired: "Verify your email address before you create API keys or connect apps.",
		verifyLink: "Go to Account",
		requestFailed: "The request failed. Wait a moment and try again.",
		title: "API keys",
		description:
			"Keys give Shortcuts and scripts full access to your account through the API. Each key is shown only once.",
		namePlaceholder: "Name (e.g. MacBook Chrome)",
		create: "Create key",
		created: "Copy your new key now. It will not be shown again.",
		copy: "Copy",
		copied: "Copied",
		revoke: "Revoke",
		revokeConfirm: "Revoke this key? Anything using it will stop working.",
		empty: "No keys yet.",
		lastUsed: "Last used {{date}}",
		neverUsed: "Never used",
	},
	connectedApps: {
		title: "Connected apps",
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
	},
}
