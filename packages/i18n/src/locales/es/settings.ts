export default {
	title: "Ajustes",
	nav: {
		general: "General",
		connections: "Conexiones",
		data: "Datos",
	},
	profile: {
		title: "Perfil",
		description: "Tu nombre y el idioma que usa Klipstack.",
		saved: "Ajustes guardados.",
	},
	appearance: {
		title: "Apariencia",
		description: "Sigue el ajuste claro u oscuro de tu dispositivo, o fuerza uno.",
	},
	shortcuts: {
		title: "Atajos de teclado",
		description:
			"Algunas teclas solas actúan sobre los artículos: S destaca, E archiva, # elimina, J y K mueven. Desactívalas si usas entrada por voz o un lector de pantalla. Intro, las flechas y Esc siguen funcionando.",
		singleKey: "Atajos de una sola tecla",
	},
	features: {
		title: "Funciones",
		description: "Activa o desactiva partes de Klipstack en tu cuenta.",
		ai: {
			title: "Respuestas de IA",
			label: "Preguntar a la IA mientras lees",
			description:
				"Pregunta por un pasaje, conversa sobre un artículo y obtén un resumen, respondidos por IA. Desactivadas, las respuestas que ya tienes se quedan, para leerlas y borrarlas.",
		},
		editions: {
			title: "Ediciones",
			label: "Hacer ediciones",
			description:
				"Reúne lo que mereció la pena leer en una página pública que puedes compartir. Desactivadas, no se borra nada, y las ediciones que publicaste siguen públicas.",
		},
		feeds: {
			title: "Feeds",
			label: "Seguir sitios y blogs",
			description:
				"Las entradas nuevas de los sitios que sigues, para guardar las que valga la pena leer. Desactivados, no se borra nada: los sitios que sigues se guardan para cuando vuelvas a activarlos.",
		},
		topics: {
			title: "Temas",
			label: "Ordenar mi biblioteca por temas",
			description:
				"Temas propuestos a partir de tu biblioteca y siempre al día. El texto de los artículos va a la IA para ordenarlo.",
			confirm: "Desactivar los temas los borra, y dónde estaba cada artículo.",
			turnOff: "Desactivar y borrar",
			keep: "Conservarlos",
			open: "Abrir Temas",
		},
	},
	account: {
		title: "Cuenta",
		signInTitle: "Correo e inicio de sesión",
		email: "Sesión iniciada como {{email}}",
	},
	signIn: {
		title: "Formas de iniciar sesión",
		description: "Añade una contraseña o conecta una cuenta que ya usas.",
		descriptionWithLinks:
			"Siempre puedes entrar con un enlace enviado a tu correo. Añade una contraseña o conecta una cuenta que ya usas.",
		verifyFirst: "Verifica tu correo antes de añadir una contraseña o conectar una cuenta.",
		currentPassword: "Contraseña actual",
		newPassword: "Nueva contraseña",
		setHint: "Aún no tienes contraseña.",
		changeHint: "Cambiarla cierra tu sesión en tus otros dispositivos.",
		setPassword: "Establecer contraseña",
		changePassword: "Cambiar contraseña",
		passwordSaved: "Contraseña guardada.",
		wrongPassword: "Esa no es tu contraseña actual.",
		badLength: "Usa al menos {{min}} caracteres.",
		limited: "Demasiados intentos. Inténtalo más tarde.",
		failed: "No funcionó. Inténtalo de nuevo.",
		connected: "Conectada",
		connect: "Conectar",
		disconnect: "Desconectar",
		connectNamed: "Conectar {{provider}}",
		disconnectNamed: "Desconectar {{provider}}",
		lastMethod: "Es tu única forma de iniciar sesión. Añade una contraseña antes de desconectarla.",
		errors: {
			emailMismatch:
				"Esa cuenta usa otra dirección de correo. Conecta una que use la dirección de esta cuenta.",
			linkedElsewhere: "Esa cuenta ya está conectada a otra cuenta de Klipstack.",
			failed: "No pudimos conectar esa cuenta. Inténtalo de nuevo.",
		},
	},
	capture: {
		title: "Guarda desde cualquier sitio",
		extension: {
			title: "Extensión del navegador",
			description:
				"Un clic guarda la página tal como la ves, incluidos artículos tras un inicio de sesión o muro de pago. Instálala en un navegador donde hayas iniciado sesión en Klipstack.",
			install: "Obtener la extensión",
		},
		bookmarklet: {
			title: "Bookmarklet",
			description:
				"Arrástralo a tu barra de marcadores. Abre un formulario de confirmación en Klipstack con la dirección de la página actual (solo web abierta).",
			label: "Guardar en Klipstack",
		},
		shortcut: {
			title: "Atajo de iOS / macOS",
			description:
				"iOS no ofrece destinos de compartir para apps web, así que un Atajo es la forma de que la hoja de compartir llegue a Klipstack. Crea uno que acepte páginas web de Safari y URLs:",
			step1:
				"Ejecutar JavaScript en página web (solo desde la hoja de compartir de Safari): completion(document.documentElement.outerHTML)",
			step2: "Obtener contenido de URL: POST {{url}}",
			step3: "Cabeceras: Authorization = Bearer <tu clave API>, Content-Type = application/json",
			step4: "Cuerpo de la petición (JSON): url = Entrada del atajo, html = resultado del paso 1",
			note: "El paso 1 captura la página tal como la ves, así que funcionan los artículos tras un inicio de sesión o muro de pago. Al compartir desde otras apps, omítelo y envía solo la url.",
		},
	},
	apiKeys: {
		verificationRequired: "Verifica tu correo antes de crear claves de API o conectar apps.",
		verifyLink: "Ir a Cuenta",
		requestFailed: "La solicitud falló. Espera un momento e inténtalo de nuevo.",
		title: "Claves API",
		description:
			"Las claves dan a los Atajos y a tus scripts acceso completo a tu cuenta a través de la API. Cada clave se muestra una sola vez.",
		namePlaceholder: "Nombre (p. ej. Chrome del MacBook)",
		create: "Crear clave",
		created: "Copia tu nueva clave ahora. No se volverá a mostrar.",
		copy: "Copiar",
		copied: "Copiada",
		revoke: "Revocar",
		revokeConfirm: "¿Revocar esta clave? Todo lo que la use dejará de funcionar.",
		empty: "Aún no hay claves.",
		lastUsed: "Usada por última vez {{date}}",
		neverUsed: "Nunca usada",
	},
	connectedApps: {
		title: "Apps conectadas",
		description: "Apps a las que diste acceso a tu cuenta, como asistentes de IA.",
		mcpHint:
			"Para conectar un asistente de IA, añade Klipstack como servidor MCP remoto con esta URL:",
		promptHint:
			"O copia una instrucción en el asistente: añade Klipstack por sí mismo, o te dice cómo.",
		empty: "No hay apps conectadas.",
		connectedOn: "Conectada el {{date}}",
		disconnect: "Desconectar",
		disconnectConfirm: "¿Desconectar esta app? Perderá el acceso a tu cuenta.",
	},
	usage: {
		title: "Uso",
		description:
			"Todas las cuentas tienen los mismos límites. Los contadores mensuales vuelven a cero el {{date}}.",
		saves: "Artículos guardados este mes",
		storage: "Almacenamiento",
		feeds: "Feeds que sigues",
		editions: "Ediciones publicadas este mes",
		shares: "Subrayados compartidos este mes",
		ai: "Preguntas a la IA este mes",
		count: "{{used}} de {{max}}",
		megabytes: "{{used}} MB de {{max}} MB",
	},
	data: {
		title: "Tus datos",
		description:
			"Descarga todo: un archivo Markdown por artículo con sus subrayados, más un paquete JSON.",
		zip: "Descargar .zip (Markdown + JSON)",
		json: "Descargar .json",
	},
	about: {
		title: "Acerca de",
		description:
			"La versión de la aplicación que está ejecutando esta página, y los términos bajo los que funciona.",
		update: "Hay una versión nueva — recargar",
	},
	danger: {
		title: "Eliminar cuenta",
		description:
			"Elimina tu cuenta y todos tus artículos, subrayados e imágenes. No se puede deshacer.",
		confirmLabel: "Escribe tu correo para confirmar",
		submit: "Eliminar mi cuenta",
		mismatch: "El correo no coincide.",
	},
	reauth: {
		message:
			"Iniciaste sesión hace más de 30 minutos. Vuelve a iniciar sesión para hacer esto: una sesión abierta en otro sitio no puede.",
		button: "Volver a iniciar sesión",
	},
} satisfies typeof import("../en/settings").default
