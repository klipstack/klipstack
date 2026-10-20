export default {
	email: "Correo electrónico",
	password: "Contraseña",
	name: "Nombre",
	inviteCode: "Código de invitación",
	login: {
		title: "Iniciar sesión",
		submit: "Entrar",
		withMagicLink: "Prefiero recibir un enlace por correo",
		forgotPassword: "¿Olvidaste tu contraseña?",
		noAccount: "¿Aún no tienes cuenta?",
		signup: "Regístrate",
		invalid: "Correo o contraseña incorrectos.",
		oauthNote: "Inicia sesión para seguir conectando una app a tu cuenta de Klipstack.",
	},
	signup: {
		title: "Crea tu cuenta",
		submit: "Crear cuenta",
		agree: "Al crear una cuenta, aceptas los",
		terms: "términos de uso",
		haveAccount: "¿Ya tienes cuenta?",
		login: "Inicia sesión",
		inviteRequired:
			"Por ahora Klipstack es solo con invitación. Introduce el código que recibiste.",
		invalidInvite: "Ese código de invitación no es válido o ya fue usado.",
		emailTaken: "Ya existe una cuenta con este correo.",
		passwordTooShort: "La contraseña debe tener al menos {{min}} caracteres.",
		noCode: "¿No tienes código?",
		requestInvite: "Pide una invitación",
	},
	requestInvite: {
		title: "Pide una invitación",
		description:
			"Por ahora Klipstack es solo con invitación. Deja tu correo y te enviaremos una invitación cuando haya sitio.",
		note: "¿Para qué usarías Klipstack? (opcional)",
		noteHint: "Hasta {{max}} caracteres.",
		noteTooLong: "Escribe menos de {{max}} caracteres.",
		trap: "Deja esto vacío",
		submit: "Pedir invitación",
		receivedTitle: "Gracias",
		received:
			"Si hay sitio, te enviaremos un código de invitación por correo. Si ya tienes cuenta, inicia sesión.",
		expired: "El formulario estuvo abierto demasiado tiempo. Envíalo de nuevo.",
		full: "La lista de espera está llena por ahora. Inténtalo más tarde.",
		backHome: "Volver a Klipstack",
		haveCode: "¿Tienes un código de invitación?",
		signup: "Crea tu cuenta",
		email: {
			subject: "Tu invitación a Klipstack",
			body: "Pediste probar Klipstack. Tu código de invitación es {{code}}. Sirve durante {{days}} días.",
			cta: "Crear mi cuenta",
			footer: "Si no lo pediste, puedes ignorar este correo.",
		},
	},
	providers: {
		or: "o",
		continueWith: "Continuar con {{provider}}",
		errors: {
			inviteRequired:
				"Ninguna cuenta de Klipstack usa ese acceso todavía. Regístrate con un código de invitación para crear una.",
			notLinked:
				"Una cuenta de Klipstack ya usa esa dirección de correo. Inicia sesión de otra forma y conecta esta cuenta en Ajustes.",
			noEmail: "Esa cuenta no compartió ninguna dirección de correo. Klipstack necesita una.",
			failed: "No pudimos iniciar tu sesión de esa forma. Inténtalo de nuevo.",
		},
	},
	magicLink: {
		title: "Entrar con un enlace",
		description: "Te enviaremos un enlace de un solo uso. Sin contraseña.",
		submit: "Enviarme un enlace",
		sentTitle: "Revisa tu correo",
		sentDescription:
			"Si existe una cuenta para {{email}}, el enlace va en camino. Caduca en {{minutes}} minutos.",
		backToLogin: "Volver a iniciar sesión",
		emailSubject: "Tu enlace para entrar en Klipstack",
		emailBody: "Haz clic en el enlace para entrar en Klipstack. Caduca en {{minutes}} minutos.",
		emailCta: "Entrar en Klipstack",
		emailIgnore: "Si no lo solicitaste, puedes ignorar este correo.",
	},
	signInCode: {
		emailSubject: "Tu código para entrar en Klipstack",
		emailBody:
			"Escribe este código en la app de Klipstack para entrar. Caduca en {{minutes}} minutos.",
		verifyBody:
			"Escribe este código en la app de Klipstack para confirmar tu correo electrónico y entrar. Caduca en {{minutes}} minutos. Por tu seguridad, entrar de esta forma cierra las sesiones anteriores y elimina tu contraseña. Puedes crear una contraseña nueva desde la página de inicio de sesión.",
		emailIgnore: "Si no lo solicitaste, puedes ignorar este correo. No compartas este código.",
	},
	signUpCode: {
		emailSubject: "Tu código para crear tu cuenta de Klipstack",
		emailBody:
			"Escribe este código en la app de Klipstack para confirmar tu correo electrónico y crear tu cuenta. Caduca en {{minutes}} minutos.",
		existingSubject: "Ya tienes una cuenta de Klipstack",
		existingBody:
			"Alguien intentó crear una cuenta de Klipstack en la app con este correo electrónico, que ya tiene una. Para entrar, inicia sesión en la app con tu contraseña o con un código por correo.",
		emailIgnore: "Si no lo solicitaste, puedes ignorar este correo. No compartas este código.",
	},
	signupLink: {
		passwordHint: "Opcional. Déjala vacía y te enviaremos un enlace para crear tu cuenta.",
		sentTitle: "Revisa tu correo",
		sentDescription:
			"Enviamos un enlace a {{email}}. Ábrelo para continuar. Caduca en {{minutes}} minutos.",
		failed: "No pudimos enviar el correo. Inténtalo de nuevo.",
		confirmTitle: "Crea tu cuenta",
		confirmDescription:
			"Esto crea tu cuenta de Klipstack para {{email}}. Entrarás con enlaces enviados a esta dirección. Puedes añadir una contraseña más tarde.",
		expiredTitle: "Enlace caducado",
		expired: "Este enlace ha caducado o ya se usó.",
		inviteTitle: "La invitación ya no es válida",
		invite:
			"El código de invitación de este enlace ya se usó o ha caducado. Regístrate de nuevo con otro código.",
		existsTitle: "Ya tienes una cuenta",
		exists: "Ya existe una cuenta para esta dirección. Inicia sesión.",
		startAgain: "Registrarme de nuevo",
		emailSubject: "Crea tu cuenta de Klipstack",
		emailBody:
			"Haz clic en el enlace para terminar de crear tu cuenta de Klipstack. Caduca en {{minutes}} minutos.",
		emailCta: "Crear mi cuenta",
		emailIgnore: "Si no lo solicitaste, puedes ignorar este correo. No se crea ninguna cuenta.",
	},
	resetPassword: {
		requestTitle: "Restablece tu contraseña",
		requestDescription: "Te enviaremos un enlace para elegir una contraseña nueva.",
		requestSubmit: "Enviar enlace",
		sentTitle: "Revisa tu correo",
		sentDescription:
			"Si existe una cuenta para {{email}}, el enlace va en camino. Caduca en {{minutes}} minutos.",
		title: "Elige una contraseña nueva",
		description: "Esto cierra tu sesión en todos los dispositivos.",
		newPassword: "Contraseña nueva",
		submit: "Guardar contraseña",
		done: "Contraseña guardada. Inicia sesión con tu contraseña nueva.",
		expiredTitle: "Enlace caducado",
		expired: "Este enlace ha caducado o ya se usó.",
		requestAgain: "Solicitar un enlace nuevo",
		emailSubject: "Restablece tu contraseña de Klipstack",
		emailBody:
			"Haz clic en el enlace para elegir una contraseña nueva. Caduca en {{minutes}} minutos. Al guardarla se cierra tu sesión en todos los dispositivos.",
		emailCta: "Elegir una contraseña nueva",
		emailIgnore: "Si no lo solicitaste, puedes ignorar este correo. Tu contraseña no cambia.",
	},
	verification: {
		title: "Verifica tu correo electrónico",
		description:
			"{{email}} aún no está verificado. Verifícalo para crear claves de API y conectar apps.",
		instructions:
			"Abre el enlace en un navegador donde tengas la sesión iniciada. Tu contraseña y tus sesiones no cambian.",
		loginNote:
			"Inicia sesión con tu contraseña para terminar de verificar tu correo. Tu contraseña no cambia.",
		send: "Enviar correo de verificación",
		resend: "Reenviar correo de verificación",
		sending: "Enviando…",
		sent: "Revisa {{email}} para abrir tu enlace de verificación. Caduca en {{minutes}} minutos. Si no llega, revisa la carpeta de correo no deseado.",
		verified: "Correo verificado",
		unavailable:
			"Los correos de verificación no están disponibles en este momento. Inténtalo más tarde o contacta con el responsable del servidor.",
		failed: "No pudimos enviar el correo. Inténtalo de nuevo.",
		limited: "Demasiadas solicitudes. Inténtalo de nuevo en {{minutes}} minutos.",
		expired: "Este enlace ha caducado o no es válido. Solicita un nuevo correo de verificación.",
		wrongAccount:
			"Ese enlace verifica otra cuenta. Inicia sesión en esa cuenta y abre el enlace de nuevo.",
		emailSubject: "Verifica tu correo de Klipstack",
		emailBody:
			"Confirma que esta dirección es tuya. El enlace caduca en {{minutes}} minutos. Ábrelo en un navegador donde tengas la sesión iniciada en Klipstack, o inicia sesión con tu contraseña cuando se te pida.",
		emailCta: "Verificar correo",
		emailIgnore:
			"Si no creaste una cuenta de Klipstack, puedes ignorar este correo. El enlace no hace nada sin la contraseña de la cuenta.",
		loginEmailBody:
			"Confirma tu correo electrónico e inicia sesión en Klipstack. Este enlace caduca en {{minutes}} minutos. Por tu seguridad, entrar de esta forma cierra las sesiones anteriores y elimina tu contraseña. Puedes crear una contraseña nueva desde la página de inicio de sesión.",
		loginEmailCta: "Verificar correo e iniciar sesión",
	},
	oauth: {
		title: "Conectar una app",
		intro: "{{app}} quiere acceder a tu cuenta de Klipstack.",
		identifiedBy: "Identificada por {{host}}.",
		unverified:
			"Klipstack no ha verificado esta app. Permítela solo si acabas de empezar a conectarla.",
		firstPartyCli: "Permítelo solo si acabas de ejecutar {{command}} en tu ordenador.",
		firstPartyMobile: "Permítelo solo si acabas de tocar Iniciar sesión en la app de Klipstack.",
		scopesTitle: "Podrá:",
		redirectsTo: "Volverás a {{target}}.",
		revokeHint: "Puedes desconectarla cuando quieras en Ajustes.",
		allow: "Permitir",
		deny: "Denegar",
		invalid: "Esta solicitud no es válida o ha caducado. Empieza de nuevo desde la app.",
		signedInAs: "Sesión iniciada como",
		switchAccount: "Usar otra cuenta",
		signInAgain:
			"Iniciaste sesión hace más de 30 minutos. Vuelve a iniciar sesión para conectar una app nueva: una sesión abierta en otro sitio no puede conectarla.",
		signInAgainButton: "Volver a iniciar sesión",
		optionalHint: "Desmarca la casilla para permitir solo lectura.",
		verify: {
			title: "Verifica tu correo para continuar",
			description:
				"Una app solo puede conectarse a una cuenta con el correo verificado, y {{email}} aún no lo está.",
			instructions:
				"Abre el enlace de verificación de tu correo, vuelve aquí y elige Continuar. Tu sesión sigue iniciada.",
			pending: "Tu correo aún no está verificado. Abre el enlace del correo y elige Continuar.",
			continue: "Continuar",
		},
		identity: {
			name: "Confirmar que eres tú y ver tu nombre",
			email: "Confirmar que eres tú y ver tu correo electrónico",
			nameAndEmail: "Confirmar que eres tú y ver tu nombre y tu correo electrónico",
		},
		scopes: {
			openid: "Confirmar que eres tú",
			profile: "Ver tu nombre",
			email: "Ver tu correo electrónico",
			offline_access: "Seguir conectada hasta que la desconectes",
			library_read: "Leer tu biblioteca: artículos guardados, destacados y notas",
			library_write:
				"Cambiar tu biblioteca: guardar artículos, archivarlos, marcarlos con estrella y renombrarlos, editar notas y destacados, y mover artículos a la papelera",
		},
	},
	welcomeEmail: {
		subject: "Te damos la bienvenida a Klipstack",
		heading: "Te damos la bienvenida a Klipstack, {{firstName}}",
		headingNoName: "Te damos la bienvenida a Klipstack",
		intro:
			"Gracias por unirte. Klipstack es un lugar tranquilo para lo que lees: guarda un artículo, lee una copia limpia y conserva tus subrayados y notas junto al texto.",
		extension:
			"La forma más rápida de guardar es la extensión del navegador para Chrome. Guarda la página tal como la ves, incluso detrás de un inicio de sesión: {{url}}",
		ways: "También puedes guardar con un botón en tu barra de marcadores, o desde tu asistente de IA, que además encuentra lo que subrayaste. El botón de abajo te enseña cada uno.",
		reply:
			"Si algo no funciona o echas algo en falta, responde a este correo. Me llega a mí y los leo todos.",
		cta: "Ver las formas de guardar",
	},
	validation: {
		emailInvalid: "Introduce un correo válido.",
		required: "Este campo es obligatorio.",
	},
} satisfies typeof import("../en/auth").default
