export default {
	appName: "Klipstack",
	home: {
		headline: "¿Qué <mark>leíste</mark> <em>esta semana?</em>",
		description:
			"Klipstack guarda los artículos que quieres leer y te da un lugar tranquilo para leerlos. Tus subrayados y notas se quedan con ellos, enlazados entre sí.",
		login: "Iniciar sesión",
		openApp: "Abrir Klipstack",
		signup: "Crear cuenta",
		inviteOnly: "Solo con invitación, por ahora.",
		requestInvite: "Pide una invitación",
		hero: {
			eyebrow: "Una app para leer después · Solo con invitación, por ahora",
			emailLabel: "Correo electrónico",
			admission: "Klipstack deja entrar a la gente de a poco.",
			haveCode: "¿Tienes un código de invitación?",
			lede: "Cuando una semana de lecturas merece compartirse, publícala como una edición.",
		},
		try: {
			eyebrow: "Pruébalo",
			title: "Marca lo que importa.",
			description:
				"Así se lee un artículo en Klipstack. Subraya una frase y aparecerá en la edición de muestra de abajo.",
		},
		demo: {
			label: "Un artículo de muestra que puedes subrayar",
			hint: "Esto funciona como un artículo en Klipstack. Toca una frase para subrayarla. Toca un subrayado para quitarlo.",
			clear: "Borrar",
			site: "ensayos.example",
			readingTime: "3 min de lectura",
			title: "Lo que nos queda de lo que leemos",
			sentences: {
				s1: "Casi todo lo que leemos se nos va en una semana.",
				s2: "El artículo era bueno y asentimos al leerlo.",
				s3: "Después quedó enterrado bajo todo lo que vino.",
				s4: "Los lectores resolvieron esto hace mucho, con un lápiz.",
				s5: "Una frase marcada es una nota para tu yo del futuro.",
				s6: "Escribe una línea al lado y empiezas una conversación que puedes retomar años después.",
				s7: "Klipstack hace lo mismo con lo que lees en una pantalla.",
				s8: "Guarda cada marca que haces junto a las palabras donde la hiciste.",
			},
			marginNote: "Por esto subrayo.",
			articleNote: "Va bien con",
			linkedTitle: "En defensa de releer",
			backlinks: "Enlazado desde 2 artículos",
		},
		edition: {
			eyebrow: "Ediciones",
			title: "Comparte una semana de lectura.",
			description:
				"Una edición es una página con lo que leíste en una semana o un mes: los enlaces, una breve introducción y los pocos subrayados y notas que eliges compartir. Lleva a los lectores a los artículos originales y nunca los vuelve a publicar.",
			tryIt:
				"Los subrayados que hiciste arriba ya están en esta. Marca más y mira el límite: una edición cita como mucho una décima parte de un artículo, nunca más de 150 palabras, para que no pueda reconstruirlo.",
			private:
				"Nada es público hasta que lo publicas. El enlace no aparece en ningún listado y pide a los buscadores que no lo indexen. Las ediciones están en beta.",
			previewLabel: "Una edición de muestra con tus subrayados",
			kicker: "Una edición",
			name: "Semana 40, 2026",
			intro: "Un solo ensayo esta semana, y fue suficiente.",
			empty: "Subraya una frase arriba y aparecerá aquí.",
			counter: "{{count}} / {{max}} palabras citadas",
			over: "Fuera: supera el límite",
		},
		steps: {
			eyebrow: "Cómo funciona",
			title: "Guarda, lee, marca. Publica si quieres.",
			save: {
				title: "Guarda",
				description:
					"Pega un enlace, sigue el feed de un sitio o usa la extensión para Chrome y Firefox. La extensión guarda la página tal como la ves, aunque requiera iniciar sesión.",
			},
			read: {
				title: "Lee",
				description:
					"Una página limpia, con la letra y el tamaño que prefieras, clara u oscura. Klipstack recuerda dónde quedaste y deja los artículos sin leer listos sin conexión.",
			},
			mark: {
				title: "Marca",
				description:
					"Subraya y escribe en el margen. Escribe [[ en una nota para enlazar otro artículo. Los enlaces entre artículos guardados se conectan solos.",
			},
			publish: {
				title: "Publica, si quieres",
				description:
					"Elige una semana, un mes o las fechas que quieras, decide qué va en la página y comparte un enlace. O guárdalo todo para ti.",
			},
			find: {
				title: "Encuéntralo de nuevo",
				description:
					"Busca en cada palabra que guardaste, también en tus notas. Filtra con tag:, fija las búsquedas que repites y salta a cualquier parte con ⌘K.",
			},
			ask: {
				title: "Pregunta al leer",
				badge: "Beta",
				description:
					"Selecciona una palabra o un pasaje y recibe en el margen una explicación, una definición o una respuesta, citando los párrafos en que se basa. O lee un resumen del artículo y conversa sobre él.",
			},
			assistant: {
				title: "Trae a tu asistente",
				badge: "Beta",
				description:
					"Conecta Claude u otro cliente MCP para buscar y leer tu biblioteca. Tú decides si además puede guardar y etiquetar, y puedes desconectarlo en Ajustes.",
			},
			phone: {
				title: "En tu teléfono",
				badge: "Muy pronto",
				description:
					"Klipstack funciona en el navegador de tu teléfono, también sin conexión. Viene una app para iPhone.",
			},
		},
		commitments: {
			eyebrow: "Compromisos",
			title: "Hecho para que puedas irte.",
			intro:
				"Pocket cerró en julio de 2025. Omnivore cerró en noviembre de 2024. Sus lectores tuvieron que mudar años de lectura en el plazo de otros. Klipstack es nuevo y pequeño, así que en vez de pedirte que confíes en que dure para siempre, hace que irse sea fácil.",
			private: {
				title: "Sin anuncios. Sin rastreo.",
				description:
					"Klipstack nunca muestra anuncios ni vende lo que lees. Ninguna analítica te sigue.",
			},
			export: {
				title: "Exporta todo, cuando quieras.",
				description:
					"Una descarga desde Ajustes: un archivo Markdown por artículo con sus subrayados, más un paquete JSON con todo.",
			},
			delete: {
				title: "Eliminar es eliminar.",
				description:
					"Los artículos eliminados esperan 30 días en la papelera y luego desaparecen. Elimina tu cuenta y todo se va con ella, ediciones incluidas.",
			},
			source: {
				title: "Las ediciones enlazan a la fuente.",
				description:
					"Una edición muestra títulos, las citas que elegiste y tus notas, y lleva a los lectores al sitio original.",
			},
			copy: {
				title: "Tu copia sobrevive al enlace.",
				description:
					"Klipstack guarda una copia limpia de cada artículo y sus imágenes, para que siga legible cuando el original cambia o desaparece.",
			},
			assistant: {
				title: "Tu asistente, con tus reglas.",
				description:
					"Un asistente de IA entra solo después de que lo apruebas. Tú eliges si puede cambiar algo, y puedes cortarle el acceso.",
			},
			privacy: "Lee la política de privacidad",
		},
		faq: {
			eyebrow: "Preguntas",
			title: "Respuestas directas.",
			free: {
				question: "¿Es gratis?",
				answer:
					"Hoy no hay nada que pagar ni tarjeta que ingresar. El precio aún no está decidido. Cuando lo esté, aparecerá en esta página antes de que se le pida pagar a nadie.",
			},
			invite: {
				question: "¿Por qué solo con invitación?",
				answer:
					"Una sola persona construye y mantiene Klipstack. Cada lector nuevo suma almacenamiento y trabajo de servidor, así que la gente entra de a poco. Pide una invitación y te llegará un correo cuando haya lugar.",
			},
			import: {
				question: "¿Puedo importar desde Pocket u Omnivore?",
				answer:
					"Todavía no. Hoy no hay importador para Pocket, Omnivore, Instapaper ni Readwise, así que guarda tu archivo de exportación. Puedes guardar enlaces de a uno y traer tus feeds con OPML.",
			},
			apps: {
				question: "¿Hay una app?",
				answer:
					"Klipstack funciona en el navegador de tu computador y de tu teléfono, y los artículos sin leer y destacados siguen disponibles sin conexión. Viene una app para iPhone. No hay app para Android.",
			},
			extension: {
				question: "¿Hay una extensión para el navegador?",
				answer:
					"Sí, para Chrome y Firefox. Aún no está en las tiendas de extensiones: cuando entres, la instalas desde Ajustes.",
			},
			privacy: {
				question: "¿Quién puede ver lo que leo?",
				answer:
					"Solo tú. Tu biblioteca, etiquetas, subrayados y notas son privados. Una edición se hace pública solo cuando la publicas, y muestra solo lo que elegiste.",
			},
		},
		invite: {
			eyebrow: "Solo con invitación, por ahora",
			title: "Pide una invitación.",
			description:
				"Deja tu correo y te llegará una invitación cuando haya lugar. Las invitaciones salen de a pocas, para que la app siga rápida.",
			privacy: "Tu correo se usa para la invitación y nada más. Sin boletines.",
			signupTitle: "Empieza a leer.",
			signupDescription: "¿Tienes un código de invitación? Crea tu cuenta.",
		},
		footer: {
			label: "Sitio",
			terms: "Términos",
			privacy: "Privacidad",
			support: "Ayuda",
			copyright: "© {{year}} {{company}}",
		},
	},
	support: {
		title: "Ayuda",
		description: "Ayuda con Klipstack: escríbenos, gestiona tus datos o elimina tu cuenta.",
		contact: {
			title: "Escríbenos",
			body: "Para preguntas, problemas o comentarios, escribe a",
			tips: "Cuéntanos qué intentaste, qué pasó y en qué dispositivo. Si se trata de un artículo, incluye su enlace.",
		},
		account: {
			title: "Tu cuenta y tus datos",
			export: "Descarga toda tu biblioteca, con subrayados y notas, en Ajustes, en Tus datos.",
			delete:
				"Elimina tu cuenta en Ajustes, en Eliminar cuenta. Se eliminan tus artículos, subrayados, notas e imágenes.",
			privacy: "La política de privacidad explica qué guardamos y para qué.",
			privacyRequest: "Para una solicitud sobre tus datos, escribe a",
		},
		report: {
			title: "Denunciar una página pública",
			body: 'Cada edición pública tiene un enlace "Denunciar esta página" al final.',
		},
		company: "Klipstack es propiedad de {{company}}, una empresa chilena, que también lo opera.",
	},
	actions: {
		save: "Guardar",
		cancel: "Cancelar",
		delete: "Eliminar",
		back: "Volver",
		close: "Cerrar",
		select: "Seleccionar",
		done: "Listo",
	},
	nav: {
		home: "Inicio",
		library: "Biblioteca",
		inbox: "Biblioteca",
		feed: "Feeds",
		feedNew: "Publicaciones nuevas",
		editionDue: "Tu próxima edición te espera",
		archive: "Archivo",
		starred: "Destacados",
		highlights: "Subrayados",
		editions: "Ediciones",
		trash: "Papelera",
		settings: "Ajustes",
		admin: "Admin",
		logout: "Cerrar sesión",
		account: "Cuenta: {{name}}",
		collapse: "Contraer la barra lateral",
		expand: "Expandir la barra lateral",
		resize: "Cambiar el ancho de la barra lateral",
		tags: "Etiquetas",
		search: "Buscar",
		tagCount: "{{count}} artículos",
		tagCount_one: "{{count}} artículo",
		tagCount_other: "{{count}} artículos",
		menu: "Menú",
		add: "Añadir",
	},
	savedSearches: {
		heading: "Búsquedas guardadas",
		save: "Guardar búsqueda",
		saved: "Guardada",
		savedAs: "Guardada como «{{name}}»",
		saveCommand: "Guardar esta búsqueda",
		saveTitle: "Guardar búsqueda",
		renameTitle: "Cambiar el nombre de la búsqueda",
		nameLabel: "Nombre",
		rename: "Cambiar nombre",
		more: "Más opciones de «{{name}}»",
		deleted: "Se eliminó «{{name}}»",
		undo: "Deshacer",
		errors: {
			invalid_name: "Un nombre tiene de 1 a 50 caracteres.",
			invalid_query: "Esta búsqueda es demasiado larga para guardarla.",
			name_taken: "Otra búsqueda guardada ya tiene ese nombre.",
			too_many: "Tienes 50 búsquedas guardadas. Elimina una para guardar otra.",
			generic: "No se pudo guardar la búsqueda.",
		},
	},
	errors: {
		generic: "Algo salió mal.",
		notFound: "Página no encontrada.",
		notFoundDetail: "La página que buscas no existe.",
		gone: "Página retirada.",
		goneDetail: "Su autor retiró esta página.",
		goneRemoved: "Klipstack retiró esta página porque incumplía las reglas.",
		unexpected: "Ocurrió un error inesperado.",
		offline: "Estás sin conexión.",
		offlineDetail:
			"Esta página no está guardada para leer sin conexión. Los artículos de la biblioteca y los destacados sí.",
		invalidForm: "Revisa los errores del formulario.",
	},
	language: {
		label: "Idioma",
		en: "Inglés",
		es: "Español",
	},
	palette: {
		label: "Paleta de comandos",
		placeholder: "Busca o escribe un comando…",
		empty: "Sin resultados.",
		actions: "Acciones",
		results: "Artículos",
		navigate: "Ir a",
		search: "Buscar",
		article: "Este artículo",
		selected: "Artículo seleccionado",
		saveClipboard: "Guardar enlace del portapapeles",
		clipboardEmpty: "No hay un enlace en el portapapeles.",
		theme: "Tema: {{theme}}",
		showSidebar: "Mostrar notas y subrayados",
		hideSidebar: "Ocultar notas y subrayados",
		copyLink: "Copiar enlace original",
		searchFor: "Buscar artículos con “{{q}}”",
		copied: "Enlace copiado",
	},
	theme: {
		label: "Tema",
		system: "Sistema",
		light: "Claro",
		dark: "Oscuro",
	},
} satisfies typeof import("../en/common").default
