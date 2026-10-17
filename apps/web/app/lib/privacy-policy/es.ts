import { CONTROLLER, type Policy, PRIVACY_CONTACT } from "./types"

export default {
	title: "Política de privacidad",
	updated: "Última actualización: 17 de octubre de 2026",
	summary:
		"Klipstack guarda lo que guardas para que puedas leerlo. No vende tus datos, no muestra anuncios y no te rastrea. Esta página explica qué recopilamos, para qué, quién nos ayuda a operar el servicio y qué puedes hacer al respecto.",
	contentsLabel: "En esta página",
	email: PRIVACY_CONTACT,
	links: {
		"las condiciones comerciales de Anthropic": "https://www.anthropic.com/legal/commercial-terms",
		"el acuerdo de clientes de TypeSafe": "https://typesafe.ai/legal/mca",
	},
	sections: [
		{
			id: "who",
			title: "Quiénes somos",
			blocks: [
				`Klipstack es propiedad de ${CONTROLLER} ("nosotros"), una empresa chilena, que también lo opera. Decidimos cómo se usan tus datos y respondemos por ello.`,
				`Preguntas, solicitudes o reclamos: ${PRIVACY_CONTACT}.`,
			],
		},
		{
			id: "collect",
			title: "Qué recopilamos",
			blocks: [
				{
					list: [
						"Tu cuenta: nombre, correo y tu contraseña como un hash irreversible, nunca la contraseña misma. Tu idioma y tus ajustes de lectura.",
						"Si inicias sesión con Google o GitHub: el nombre, el correo y la foto de perfil que nos envían. No guardamos sus tokens de acceso.",
						"Lo que guardas: cada enlace, el texto y las imágenes de la página, una copia de la página tal como se guardó y la hora en que la guardaste.",
						"Lo que añades: subrayados, notas, etiquetas, búsquedas guardadas, los feeds que sigues, tu avance de lectura y lo que terminaste.",
						"Si preguntas sobre lo que lees (Explicar, Definir, Preguntar, Chat, Resumen): el pasaje, tus preguntas, las respuestas y el resumen.",
						"Inicios de sesión: para cada dispositivo con sesión abierta, su dirección IP y la descripción que el navegador da de sí mismo (user agent). Los guardamos con la sesión, para proteger tu cuenta. Una sesión termina 30 días después de su último uso.",
						"Si pides una invitación: tu correo, la nota que escribas y tu idioma. Solo los ven quienes operan Klipstack.",
						"Si denuncias una página pública: el motivo, lo que escribas, tu correo si lo das y tu idioma. Solo los ven quienes operan Klipstack. Quien publicó la página nunca ve tu denuncia ni tu correo.",
						"Límites contra el abuso: en los intentos de inicio de sesión, las solicitudes de invitación y las denuncias, una forma cifrada (hash) de la dirección IP y del correo. Los borramos en cerca de un día.",
						"Registros del servidor: qué página se pidió, el resultado y cuánto tardó. No incluyen tu dirección IP ni tu cuenta. Los registros de guardado pueden nombrar el número de un artículo o el nombre de un sitio web.",
						"Recuentos mensuales de cada cuenta: cuántos artículos guardaste, cuántas ediciones publicaste, cuántos subrayados compartiste y cuántas preguntas hiciste, cuántos artículos se ordenaron en temas y cuántas veces la IA propuso o revisó tus temas, cuántas veces un límite detuvo algo que hiciste, cuánto nos costó la IA de las preguntas y de los temas, y cuántas veces usaste partes de los temas (como filtrar por un tema o renombrarlo). Son solo números, sin artículos, títulos ni nombres de temas. Solo los ven quienes operan Klipstack, para aplicar los límites y decidir qué mejorar.",
					],
				},
				"No usamos servicios de analítica, anuncios, rastreadores, scripts ni fuentes de terceros, ni servicios de reporte de errores.",
			],
		},
		{
			id: "use",
			title: "Cómo lo usamos",
			blocks: [
				{
					list: [
						"Para operar Klipstack: guardar, limpiar, almacenar, mostrar y buscar lo que guardas.",
						"Para enviar correos de tu cuenta: enlaces de inicio de sesión, verificación de correo y cambio de contraseña. No enviamos boletines ni publicidad.",
						"Para responder a una solicitud de invitación. Solo te escribimos si te enviamos una.",
						"Para decidir sobre una denuncia de una página pública, y escribirte la decisión si diste un correo. Si retiramos una página, le decimos a quien la publicó por qué, sin decir quién la denunció.",
						"Para mantener el servicio seguro y frenar el abuso.",
						"Para responder preguntas sobre lo que lees y escribir el resumen de un artículo, cuando lo pides. Mira «Preguntas sobre lo que lees» más abajo.",
						"Para resolver problemas.",
					],
				},
				"No vendemos tus datos. No los usamos para publicidad ni para entrenar modelos de IA.",
				"Las personas que operan Klipstack pueden acceder a la base de datos para mantenerla. Miramos tu contenido solo para resolver un problema que nos reportes, para mantener el servicio seguro o cuando la ley lo exige.",
			],
		},
		{
			id: "fetching",
			title: "Cuando Klipstack descarga páginas por ti",
			blocks: [
				{
					list: [
						"Cuando guardas un enlace, nuestro servidor descarga la página y sus imágenes. El sitio web ve nuestro servidor, no a ti.",
						"La extensión del navegador envía la página tal como la muestra tu navegador, incluso páginas que requieren iniciar sesión o suscripción. Guarda páginas privadas con cuidado: lo que envía la extensión queda en tu biblioteca.",
						"Nuestro servidor revisa los feeds que sigues en busca de publicaciones nuevas, y lee el título y el resumen de una página para mostrar la vista previa de un enlace. Las vistas previas se guardan 15 minutos, solo en memoria.",
						"Para guardar una publicación de X (Twitter), nuestro servidor se la pide a FxTwitter, usando su dirección.",
						"Algunas imágenes de las listas se cargan directamente desde el sitio original. Tu navegador las pide sin decir de qué página vienes.",
					],
				},
			],
		},
		{
			id: "providers",
			title: "Quién más maneja tus datos",
			blocks: [
				"Algunas empresas nos ayudan a operar Klipstack. Manejan tus datos solo para prestarnos su servicio.",
				{
					list: [
						"Hetzner Online aloja nuestros servidores y la base de datos.",
						"Cloudflare guarda las imágenes de las páginas que guardas y nuestras copias de seguridad cifradas de la base de datos (R2).",
						"Resend envía nuestros correos. Recibe tu dirección de correo y el mensaje.",
						"SuppyHQ hace funcionar el formulario de ayuda de la app. No recibe nada hasta que haces clic en Contactar con soporte; entonces recibe tu nombre y tu dirección de correo, y el mensaje que envíes.",
						"Better Stack comprueba desde fuera que Klipstack funciona. No ve datos de cuentas.",
						"Google o GitHub, solo si eliges iniciar sesión con ellos.",
						"FxTwitter, solo cuando guardas una publicación de X.",
						"Anthropic responde preguntas sobre lo que lees y escribe resúmenes, solo cuando lo pides, y pone nombre a tus temas, solo si activas los temas.",
						"TypeSafe ordena tus artículos en temas, solo si activas los temas.",
					],
				},
				"No compartimos tus datos con nadie más, salvo que la ley lo exija. Si ocurre, te avisamos, salvo que la ley lo prohíba.",
			],
		},
		{
			id: "ai",
			title: "Preguntas sobre lo que lees",
			blocks: [
				"En el lector, en la web o en la app para iPhone, puedes preguntar sobre un pasaje (que te lo explique, que defina una palabra o hacer una pregunta), chatear sobre todo el artículo o pedir su resumen (Sum Up en la app para iPhone): una explicación breve de lo que dice y de cómo está organizado. Solo entonces nuestro servidor le envía a Anthropic el texto del artículo y lo que pediste: el pasaje, tu pregunta y, cuando sigues preguntando, las preguntas y respuestas anteriores. Luego te muestra la respuesta. Aparte de los temas, más abajo, no se envía nada si no preguntas.",
				"Anthropic los usa solo para responder, según las condiciones comerciales de Anthropic, y no entrena sus modelos con ellos.",
				"Guardamos tus preguntas y las respuestas con el artículo, para que puedas volver a leerlas, hasta que las borres o borres el artículo, y su resumen hasta que borres el artículo. Los registros del servidor anotan que se respondió una pregunta y su tamaño, nunca lo que decía.",
			],
		},
		{
			id: "topics",
			title: "Temas automáticos",
			blocks: [
				"Los temas están desactivados hasta que los activas, en la página Temas. Mientras están activados, nuestro servidor envía cada artículo que guardas a TypeSafe, que lo ordena en tus temas: su título, su sitio, su descripción y el comienzo de su texto. También envía a Anthropic los títulos, los sitios y las descripciones de tus artículos (de uno sin descripción, las primeras líneas de su texto), para proponer tus temas, crear otros nuevos y revisarlos.",
				"Según el acuerdo de clientes de TypeSafe, TypeSafe usa lo que le enviamos para ordenarlo y no entrena sus modelos con ello; puede conservarlo para vigilar abusos y cumplir obligaciones legales. Anthropic trabaja según las condiciones comerciales de Anthropic, como con las preguntas.",
				"Guardamos tus temas y qué artículos están en cada uno hasta que desactivas los temas, lo que los borra, o borras tu cuenta.",
			],
		},
		{
			id: "cookies",
			title: "Cookies y almacenamiento en tu dispositivo",
			blocks: [
				"Cada cookie que usamos es necesaria para que Klipstack funcione o para recordar tus ajustes. Ninguna es para publicidad ni rastreo, así que no hay aviso de cookies.",
				{
					list: [
						"klip.session_token mantiene tu sesión abierta, hasta 30 días.",
						"klip.state protege un inicio de sesión con Google o GitHub, durante 5 minutos.",
						"lng guarda tu idioma, durante un año.",
						"klip_tz, klip_layout, klip_sidebar y klip_hl_view guardan tu zona horaria y cómo prefieres ver las listas, durante un año. Al cerrar sesión se borran las tres últimas.",
					],
				},
				"Tu navegador también guarda copias de tus artículos recientes para abrirlos sin conexión. Al cerrar sesión se borran.",
			],
		},
		{
			id: "apps",
			title: "Apps, la extensión y asistentes de IA",
			blocks: [
				{
					list: [
						"La extensión del navegador actúa solo cuando haces clic en ella o usas su menú, y solo en esa pestaña: no tiene acceso permanente a los sitios que visitas. Envía la página que guardas, con su dirección, a Klipstack y a ningún otro lugar. Antes quita los scripts y los campos ocultos de formularios. En un artículo, además descarga la página otra vez, como tu navegador, y envía también esa copia, porque algunos sitios cortan el artículo en el navegador. Guardar un enlace desde su menú envía solo el enlace. No guarda nada en tu navegador.",
						"La app para iPhone, en pruebas, guarda tu sesión en el llavero (Keychain) del iPhone, que comparte con su extensión de compartir y su widget, y guarda copias de los artículos para abrirlos sin conexión. Lee en voz alta en el propio teléfono: el texto nunca sale de él. Sus archivos de voz se descargan una vez, desde Hugging Face y GitHub. Cuando dictas una nota, el iPhone reconoce tu voz en el propio dispositivo, con el reconocimiento de voz de Apple: lo que dices nunca sale del teléfono, y a Klipstack solo llega el texto de la nota. Consultar (Look Up) abre el diccionario del propio iPhone. Lee el portapapeles solo cuando tocas Pegar. No tiene analítica ni reportes de fallos.",
						"En la app para iPhone, la IA del lector funciona como en la web y envía lo mismo: mira «Preguntas sobre lo que lees».",
						"La extensión de compartir (Klipstack en el menú Compartir del iPhone) lee solo el enlace que compartes, o el primer enlace web de un texto, y envía ese enlace a Klipstack, que lo guarda como cualquier otro.",
						"El widget «Next up» le pide a Klipstack los próximos artículos de tu bandeja de entrada (Inbox): título, sitio, tiempo de lectura, cuánto leíste y la imagen. Guarda los últimos en el teléfono para mostrarlos sin conexión. Una imagen que Klipstack no guardó se carga desde el sitio web del artículo.",
						"Puedes conectar otras apps y asistentes de IA a tu biblioteca (claves de API, MCP). Solo acceden a lo que permites, y puedes quitarlos en Ajustes cuando quieras. Lo que hagan con los datos depende de ellos y de sus propias políticas de privacidad.",
					],
				},
			],
		},
		{
			id: "retention",
			title: "Cuánto tiempo lo guardamos",
			blocks: [
				{
					list: [
						"Tu biblioteca se guarda mientras exista tu cuenta.",
						"Lo que está en la papelera se borra a los 30 días. Los guardados fallidos se borran 7 días después de que los muevas a la papelera.",
						"Una solicitud de invitación se borra cuando la respondemos, con una invitación o sin ella. Si te enviamos una invitación, la invitación conserva tu correo.",
						"Una denuncia, con tu correo, se borra cuando decidimos sobre ella. El registro de la decisión no guarda nada de la denuncia.",
						"Cuando eliminas tu cuenta, borramos tus datos e imágenes de inmediato. Las copias de seguridad cifradas conservan una copia hasta 30 días, y luego desaparece. El servidor además guarda sus propias copias durante 3 días.",
						"Los registros del servidor se sobrescriben a medida que crecen y empiezan de cero con cada actualización.",
						"Los recuentos mensuales se guardan mientras exista tu cuenta.",
						"Los registros de acciones administrativas no guardan contenido. Cuando eliminas tu cuenta dejan de apuntar a ti, y se borran a los 90 días.",
					],
				},
			],
		},
		{
			id: "rights",
			title: "Tus opciones y derechos",
			blocks: [
				{
					list: [
						"Obtener una copia: exporta toda tu biblioteca, con subrayados y notas, en Markdown y JSON desde Ajustes. Tus feeds se exportan en OPML.",
						`Corregir: cambia tu nombre en Ajustes. Para cambiar tu correo, escribe a ${PRIVACY_CONTACT}.`,
						"Eliminar: elimina tu cuenta en Ajustes, o en la pantalla Account de la app para iPhone.",
						`Cualquier otra cosa, como saber qué datos tenemos sobre ti u oponerte a un uso: escribe a ${PRIVACY_CONTACT}. Respondemos en un plazo de 30 días.`,
					],
				},
				"También puedes reclamar ante la autoridad de protección de datos de tu país.",
			],
		},
		{
			id: "security",
			title: "Cómo lo protegemos",
			blocks: [
				"Todo el tráfico va cifrado (HTTPS). Las contraseñas y las claves de API se guardan solo como hashes. Las imágenes de tus páginas guardadas son privadas y solo llegan a tu cuenta. Las copias de seguridad están cifradas, y la clave para leerlas se guarda fuera de línea. Solo las personas que operan Klipstack pueden acceder a los servidores.",
				"Ningún sistema es totalmente seguro. Si una filtración pone en riesgo tus datos, te avisaremos a ti y a las autoridades, como exige la ley.",
			],
		},
		{
			id: "children",
			title: "Menores",
			blocks: [
				"Klipstack no está pensado para menores de 16 años. No recopilamos sus datos a sabiendas.",
			],
		},
		{
			id: "changes",
			title: "Cambios en esta política",
			blocks: [
				"Cuando esta política cambia, actualizamos la fecha de arriba. Si un cambio afecta cómo usamos tus datos, te escribimos antes de que se aplique.",
			],
		},
	],
} satisfies Policy
