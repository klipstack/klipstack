export default {
	appName: "Klipstack",
	home: {
		headline: "Lee más de lo que te interesa. <mark>Quédate con lo que importa.</mark>",
		description:
			"Klipstack es una app para leer después, pensada para gente curiosa. Te ayuda a elegir qué leer, te da una página tranquila para leerlo y <strong>hace fácil detenerte al final y guardar lo que te quedó</strong>.",
		login: "Iniciar sesión",
		openApp: "Abrir Klipstack",
		signup: "Crear cuenta",
		requestInvite: "Pide una invitación",
		hero: {
			eyebrow: "Una app para leer después",
			eyebrowInvite: "Una app para leer después · Solo con invitación, por ahora",
			emailLabel: "Correo electrónico",
			admission: "Klipstack deja entrar a la gente de a poco.",
			private: "Tu biblioteca es privada. Solo compartes lo que decides publicar.",
		},
		journey: {
			label: "Un artículo, de principio a fin",
			eyebrow: "Un artículo, de principio a fin",
			title: "Sigue un artículo a través de Klipstack.",
			description:
				"Los ejemplos de abajo funcionan como la app, con un ensayo de muestra. Pruébalos: nada de lo que hagas aquí se guarda ni se publica.",
			steps: {
				choose: "Elige qué leer",
				read: "Disfruta la lectura",
				capture: "Anota lo que te quedó",
				keep: "Vuelve a ello o compártelo",
			},
		},
		choose: {
			eyebrow: "Paso 1 · Elige",
			title: "Encuentra algo que quieras leer ahora.",
			body: "Inicio parte con una pregunta simple: ¿cuánto tiempo tienes? Elige quince minutos y ves lo que cabe, contando solo los minutos que faltan en los artículos que empezaste.",
			more: "Retoma donde quedaste, mira lo que guardaste hace poco y reencuentra algunos artículos guardados hace tiempo que quizá olvidaste, unos distintos cada día. Sigue el feed de un sitio y sus publicaciones nuevas esperan junto a tu biblioteca hasta que decidas guardar alguna.",
			source:
				"Todo viene de lo que guardaste y de los sitios que sigues. Sin listas de tendencias ni recomendaciones pagadas.",
			demoLabel: "Una muestra de Inicio, en Klipstack",
			readIt: "Leerlo",
			items: {
				walk: {
					site: "cuaderno-de-campo.example",
					title: "Los placeres lentos de una caminata larga",
				},
				essay: { site: "ensayos.example", title: "Lo que nos queda de lo que leemos" },
				benches: { site: "calles.example", title: "Por qué las ciudades necesitan más bancas" },
				bread: {
					site: "notas-de-cocina.example",
					title: "Cómo el pan me enseñó a tener paciencia",
				},
				cards: {
					site: "rastros-de-papel.example",
					title: "Breve historia de la ficha de cartulina",
				},
			},
		},
		read: {
			eyebrow: "Paso 2 · Lee",
			title: "Disfruta leerlo.",
			body: "Klipstack guarda una copia limpia de cada artículo: sin anuncios ni ventanas emergentes, con la letra y el tamaño que prefieras, clara u oscura. Recuerda dónde quedaste, y los artículos sin leer están listos sin conexión.",
			more: "Subraya las líneas que quieres recordar y escribe en el margen. Los subrayados son privados: marcar una línea nunca la comparte.",
		},
		demo: {
			label: "Un artículo de muestra que puedes subrayar",
			hint: "Toca una frase para subrayarla. Toca un subrayado para quitarlo.",
			clear: "Borrar",
			site: "ensayos.example",
			title: "Lo que nos queda de lo que leemos",
			sentences: {
				s1: "Casi todo lo que leemos se nos va en una semana.",
				s2: "El artículo era bueno y asentimos al leerlo.",
				s3: "Después se abrió la siguiente pestaña y quedó enterrado bajo todo lo que vino.",
				s4: "Los lectores resolvieron esto hace mucho, con un lápiz.",
				s5: "Una frase marcada es una nota para tu yo del futuro.",
				s6: "Una línea en el margen empieza una conversación que puedes retomar años después.",
				s7: "Nada de eso toma mucho: un minuto al final, antes de lo siguiente.",
				s8: "Lo que escribes ahí es la parte del artículo que se vuelve tuya.",
			},
			marginNote: "Por esto subrayo.",
		},
		capture: {
			eyebrow: "Paso 3 · Anota",
			title: "¿Qué te quedó?",
			prompt: "Una idea, una pregunta o algo que quieras probar.",
			body: "Cuando llegas al final, Klipstack te deja un momento antes de lo siguiente: una nota sobre el artículo, solo para ti. Escríbela con tus palabras, y enlaza otro artículo que guardaste si este te lo recordó.",
			optional:
				"Escribe una línea u omítela. Si sales sin nota, el artículo igual queda terminado y en tu archivo, con todos sus subrayados, una vez que llegaste al final. Puedes añadir una nota cuando vuelvas.",
			edition:
				"Si vale la pena compartirlo, márcalo para tu próxima edición. Tienes una segunda nota, aparte, para tus lectores, que puede partir de la tuya y pulirse después.",
			demoLabel: "El final del artículo de muestra",
			demoHint: "Escribe una línea, o no. Las dos cosas están bien.",
			next: "Mira dónde termina",
		},
		keep: {
			eyebrow: "Paso 4 · Vuelve o comparte",
			title: "Una biblioteca tuya. Comparte cuando quieras.",
			body: "Tus subrayados y notas se reúnen en tu cuaderno, por artículo, y la búsqueda los cubre junto con cada palabra que guardaste. Cada día, Inicio te trae de vuelta algunos subrayados de hace un tiempo, para mirarlos otra vez.",
			demoLabel: "Dónde termina el artículo de muestra",
			notebook: {
				title: "Cuaderno",
				onlyYou: "Solo tú",
				empty: "Los subrayados y notas que hagas arriba aparecen aquí.",
				highlights_one: "{{count}} subrayado",
				highlights_other: "{{count}} subrayados",
			},
			edition: {
				eyebrow: "Ediciones",
				title: "¿Qué leíste esta semana?",
				body: "Una edición es una colección de buenas lecturas para compartir, con lo que pensaste de ellas. Reúne los artículos que marcaste, elige algunos subrayados para citar, añade una o dos líneas y publica un enlace. Lleva a los lectores a los artículos originales; no los vuelve a publicar.",
				private:
					"Tu biblioteca es privada. Una edición se hace pública solo cuando la publicas, muestra solo lo que elegiste y pide a los buscadores que no la indexen. Las ediciones están en beta.",
				notIn: "No está en una edición",
				notInBody:
					"El artículo se queda en tu biblioteca, privado. Márcalo para tu próxima edición y verás cómo se vería una.",
				draft: "Borrador · sin publicar",
				kicker: "Una edición",
				name: "Lo que leí esta semana",
				quoteHint: "Elige hasta {{count}} subrayados para citar.",
				noHighlights: "No hay subrayados para citar. El enlace y tu nota bastan.",
				publishNote: "Nadie ve esto hasta que lo publicas desde la página de la edición.",
			},
		},
		phone: {
			eyebrow: "Muy pronto · iPhone",
			title: "Klipstack llega a tu iPhone.",
			body: "La app para iPhone ya está hecha y en pruebas, en camino a la App Store. Te acompaña con la misma lectura: las próximas lecturas de Inicio, el lector limpio, tus subrayados y la nota al final de cada artículo.",
			account:
				"Una cuenta, una biblioteca: lo que guardas en el teléfono te espera en el computador, y al revés.",
			save: {
				title: "Guarda desde cualquier app",
				description:
					"Comparte un enlace desde Safari, o desde cualquier app con botón de compartir, y va directo a tu biblioteca.",
			},
			listen: {
				title: "Escucha cuando no puedes leer",
				description:
					"Klipstack lee los artículos en voz alta, en inglés o español, marcando cada frase a medida que avanza. La voz funciona en tu teléfono, así que tras una descarga inicial también sirve sin conexión.",
			},
			widget: {
				title: "Tu próxima lectura, en la pantalla de inicio",
				description: "Un widget muestra lo que sigue, a un toque de leerlo.",
			},
			shotAlt:
				"La app de Klipstack para iPhone leyendo un artículo en voz alta, con la frase que lee marcada.",
			caption: "Leyendo en voz alta, en la app para iPhone.",
		},
		basics: {
			eyebrow: "Lo básico",
			title: "Ante todo, una buena app para leer después.",
			save: {
				title: "Guarda desde cualquier parte",
				description:
					"Pega un enlace, usa la extensión para Chrome o sigue el feed de un sitio. La extensión guarda la página tal como la ves, aunque requiera iniciar sesión.",
			},
			read: {
				title: "Lee a tu manera",
				description:
					"Serif, sans o una letra para lectores con dislexia, tres anchos, clara u oscura. Los artículos sin leer y destacados se quedan en tu dispositivo para leer sin conexión.",
			},
			find: {
				title: "Encuéntralo de nuevo",
				description:
					"Busca en cada palabra que guardaste, también en tus subrayados y notas. Etiqueta lo que quieras y deja en la barra lateral las búsquedas que repites.",
			},
		},
		maker: {
			eyebrow: "Quién lo hace",
			title: "Hecho por un lector.",
			body: "Hola, soy Ernesto. Hice Klipstack para mis propias lecturas. Quería una forma más fácil de elegir qué leer, una página tranquila para leerlo y una razón para detenerme un minuto al final y anotar lo que me llevé, antes de pasar a lo siguiente.",
			more: "Ahora lo abro a otras personas a las que quizá les guste leer así. Lo construyo y lo mantengo yo mismo, así que las invitaciones salen de a poco, a medida que hay lugar.",
			signature: "Ernesto",
		},
		commitments: {
			eyebrow: "Tus lecturas, tus reglas",
			title: "Privado por defecto. Fácil de dejar.",
			intro:
				"Pocket cerró en julio de 2025 y Omnivore en noviembre de 2024, y sus lectores tuvieron que mudar años de lectura en el plazo de otros. En vez de pedirte que confíes en que dure para siempre, Klipstack hace que irse sea fácil.",
			private: {
				title: "Privado salvo que publiques.",
				description:
					"Tu biblioteca, tus subrayados y tus notas son solo tuyos. Solo es pública una edición que publicas, y solo lo que pones en ella.",
			},
			ads: {
				title: "Sin anuncios. Sin rastreadores.",
				description:
					"Klipstack nunca muestra anuncios ni vende lo que lees, y no usa servicios de analítica.",
			},
			export: {
				title: "Exporta todo, cuando quieras.",
				description:
					"Una descarga desde Ajustes: un archivo Markdown por artículo con sus subrayados y notas, más un paquete JSON con todo.",
			},
			delete: {
				title: "Eliminar es eliminar.",
				description:
					"Los artículos eliminados esperan 30 días en la papelera y luego desaparecen. Elimina tu cuenta y todo se va con ella, ediciones incluidas; las copias de respaldo caducan en 30 días.",
			},
			copy: {
				title: "Tu copia sobrevive al enlace.",
				description:
					"Klipstack guarda una copia limpia de cada artículo y sus imágenes, para que siga legible cuando el original cambia o desaparece.",
			},
			source: {
				title: "Código abierto.",
				description:
					"El código es público bajo la licencia AGPL, y hay una guía para correr tu propia copia con Docker si prefieres alojarlo tú.",
			},
			privacy: "Lee la política de privacidad",
			code: "Ver el código",
			selfHost: "Alójalo tú",
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
					"Una sola persona construye y mantiene Klipstack. Cada lector nuevo suma almacenamiento y trabajo de servidor, así que la gente entra de a poco, con una invitación por correo, a medida que hay lugar.",
			},
			note: {
				question: "¿Tengo que escribir algo después de cada artículo?",
				answer:
					"No. La nota del final es una invitación, no un paso. Lee hasta el final, ciérralo y queda terminado, con o sin nota. Muchos artículos no la necesitan.",
			},
			notes: {
				question: "¿Mi nota es lo que muestra una edición?",
				answer:
					"No. Tu nota sobre un artículo es privada. Al marcar un artículo para una edición tienes una nota aparte para tus lectores, que puede partir de la tuya. Una edición muestra tu nota privada solo si decides incluirla.",
			},
			quotes: {
				question: "¿Cuánto de un artículo puede citar una edición?",
				answer:
					"Hasta tres subrayados por artículo, y no más de una décima parte de sus palabras, 150 como máximo. Una edición apunta a la buena escritura; no puede reconstruir el texto.",
			},
			import: {
				question: "¿Puedo importar desde Pocket u Omnivore?",
				answer:
					"Todavía no. Hoy no hay importador para Pocket, Omnivore, Instapaper ni Readwise, así que guarda tu archivo de exportación. Puedes guardar enlaces de a uno y traer tus feeds con OPML.",
			},
			apps: {
				question: "¿Hay una app?",
				answer:
					"Klipstack funciona en el navegador de tu computador y de tu teléfono, y los artículos sin leer y destacados siguen disponibles sin conexión. Una app para iPhone está en pruebas: guarda desde el menú Compartir y lee los artículos en voz alta. No hay app para Android.",
			},
			extension: {
				question: "¿Hay una extensión para el navegador?",
				answer:
					"Sí, para Chrome: instálala desde la Chrome Web Store (Ajustes tiene el enlace). Firefox y Safari llegarán más adelante.",
			},
			search: {
				question: "¿Cómo encuentro las cosas después?",
				answer:
					"La búsqueda cubre cada palabra guardada, tus subrayados y tus notas. Acótala con filtros como tag:, site: o before:, guarda las búsquedas que repites y presiona ⌘K (Ctrl K) para saltar a cualquier parte.",
			},
			ai: {
				question: "¿Klipstack usa IA?",
				answer:
					"Leer, anotar y armar ediciones no la necesitan. Algunos lectores prueban funciones opcionales en beta: preguntar por un pasaje mientras lees, un resumen breve de un artículo y ordenar la biblioteca en temas. También puedes conectar un asistente como Claude para buscar en tu biblioteca, decidir si además puede hacer cambios, como guardar, etiquetar y escribir notas, y desconectarlo cuando quieras.",
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
				"Deja tu correo y, si quieres, una línea sobre lo que te gusta leer. Cuando haya lugar, te llegará un solo correo con tu invitación. Puede tardar: la gente entra de a poco.",
			privacy: "Tu correo se usa para la invitación y nada más. Sin boletines ni publicidad.",
			signupTitle: "Empieza a leer.",
			signupDescription: "¿Tienes un código de invitación? Crea tu cuenta.",
			openDescription: "Crea tu cuenta y guarda tu primer artículo.",
		},
		/** The link-preview image and the X header (scripts/icons.ts), and their description. */
		shareCard: {
			/** The reader's note on the post-it, beside the sample essay's highlighted sentence. */
			note: "Una línea mía, antes de la siguiente pestaña.",
			alt: "{{appName}}, una app para leer después: {{headline}} Al lado, un artículo con una frase resaltada y la nota de un lector en un pósit.",
		},
		footer: {
			label: "Sitio",
			terms: "Términos",
			privacy: "Privacidad",
			support: "Ayuda",
			copyright: "© {{year}} {{company}}",
		},
	},
	supportWidget: {
		open: "Contactar con soporte",
		loading: "Cargando el formulario de ayuda",
		unavailable: "El formulario de ayuda no cargó. Escribe a <email>{{email}}</email>.",
		label: "Ayuda",
		greeting:
			"Preguntas, problemas o ideas: leo cada mensaje. Si es sobre un artículo, pega su enlace.",
		acknowledgment: "Gracias, recibí tu mensaje.",
		expectation: "Te responderé al correo de tu cuenta de Klipstack, normalmente en un día o dos.",
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
		inbox: "Bandeja de entrada",
		feed: "Feeds",
		feedNew: "Publicaciones nuevas",
		editionDue: "Tu próxima edición te espera",
		topics: "Temas",
		topicsReady: "Tus primeros temas están listos",
		discover: "Descubrir",
		archive: "Archivo",
		starred: "Destacados",
		notebook: "Cuaderno",
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
	// The sidebar's Getting started card: a new account's first steps, each ticked when done.
	extensionHint:
		"Guarda cualquier página en un clic con la <store>extensión del navegador</store>.",
	gettingStarted: {
		title: "Primeros pasos",
		progress: "{{done}} de {{total}}",
		// The collapsed sidebar's icon: its tooltip and name.
		rail: "Primeros pasos: {{done}} de {{total}} hechos",
		dismiss: "Ocultar esto",
		// A step's box, to a screen reader.
		done: "Hecho",
		toDo: "Pendiente",
		// The collapsed sidebar's count, on its icon.
		badge: "{{done}}/{{total}}",
		steps: {
			save: "Guarda tu primer artículo",
			extension: "Guarda un artículo con la <store>extensión del navegador</store>",
			highlight: "Subraya un pasaje",
			feature: "Activa temas, feeds o ediciones",
			featureNoTopics: "Activa feeds o ediciones",
		},
		allSet: "Todo listo",
		allSetText: "Ya conoces lo básico. En Ajustes tienes el resto, cuando quieras.",
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
		topicEnded: "El tema «{{name}}» terminó",
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
			"Esta página no está guardada para leer sin conexión. Los de la bandeja de entrada y los destacados sí.",
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
		highlights: "Subrayados",
		notes: "Notas",
		navigate: "Ir a",
		search: "Buscar",
		article: "Este artículo",
		selected: "Artículo seleccionado",
		saveClipboard: "Guardar enlace del portapapeles",
		clipboardEmpty: "No hay un enlace en el portapapeles.",
		theme: "Tema: {{theme}}",
		showSidebar: "Mostrar notas y subrayados",
		hideSidebar: "Ocultar notas y subrayados",
		copyLink: "Copiar enlace",
		searchFor: "Buscar artículos con “{{q}}”",
		copied: "Enlace copiado",
	},
	theme: {
		label: "Tema",
		system: "Sistema",
		light: "Claro",
		dark: "Oscuro",
	},
	shortcuts: {
		title: "Atajos de teclado",
		show: "Atajos de teclado",
		off: "Los atajos de una sola tecla están desactivados.",
		offTag: "Desactivado",
		turnOn: "Activarlos",
		all: "Todos los atajos",
		groups: {
			general: "En todas partes",
			lists: "En las listas",
			reader: "En el lector",
		},
		rows: {
			palette: "Paleta de comandos: buscar, ir, actuar",
			paste: "Guardar el enlace que copiaste",
			submit: "Listo, en un campo de texto",
			listMove: "Artículo siguiente o anterior",
			listArrows: "Moverse entre las tarjetas",
			listOpen: "Abrir el artículo",
			star: "Destacar",
			shortlist: "Añadir a la próxima edición",
			archive: "Archivar",
			unread: "Marcar como no leído",
			tags: "Etiquetas",
			delete: "Eliminar",
			select: "Seleccionar el artículo",
			selectRange: "Seleccionar al moverse",
			selectAll: "Seleccionar todo",
			clear: "Quitar la selección",
			search: "Buscar",
			paragraph: "Párrafo siguiente o anterior",
			askParagraph: "Preguntar a la IA por el párrafo",
			stops: "Respuesta de la IA o nota anterior o siguiente",
			brief: "Mostrar el resumen",
			focus: "Modo concentración: atenúa todo menos el párrafo",
			leave: "Dejar de leer por párrafos",
			sidebar: "Notas y subrayados",
			chat: "Chat sobre el artículo",
			articleActions: "Destacar, próxima edición, archivar, no leído, etiquetas, eliminar",
			articleActionsWithoutEditions: "Destacar, archivar, no leído, etiquetas, eliminar",
			copyHighlight: "Copiar el subrayado activo",
			help: "Esta lista",
		},
	},
} satisfies typeof import("../en/common").default
