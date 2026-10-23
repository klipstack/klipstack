/** The reader's AI in the iPhone app: Explain, Define, Ask, the chat and the brief. */
export default {
	actions: {
		explain: "Explicar",
		define: "Definir",
		ask: "Preguntar",
		chat: "Chat",
		/** Asking about a passage, before choosing how. */
		askAi: "Preguntar a la IA",
	},
	card: {
		/** The passage asked about, quoted. */
		passage: "«{{exact}}»",
		thinking: "Pensando…",
		askPlaceholder: "Pregunta sobre este pasaje…",
		followUpPlaceholder: "Haz otra pregunta…",
		send: "Enviar",
		answerAgain: "Responder de nuevo",
		copy: "Copiar",
		failed: "No se pudo responder. Inténtalo de nuevo.",
		refused: "No se pudo responder esta pregunta.",
		suggestions: {
			example: "Dame un ejemplo",
			matters: "¿Por qué importa?",
			evidence: "¿Qué pruebas hay?",
		},
	},
	answer: {
		/** A citation's number, for VoiceOver. */
		citation: "Pasaje {{n}} del artículo",
	},
	chat: {
		title: "Chat",
		empty: "Pregunta lo que quieras sobre este artículo. Las respuestas citan las partes que usan.",
		placeholder: "Pregunta sobre este artículo…",
		clear: "Borrar chat",
		turnedOff: "Las respuestas de IA están desactivadas en Ajustes → Funciones, en la web.",
	},
	brief: {
		title: "Resumen",
		/** Above the article's title, in capitals. */
		sumUp: "EN RESUMEN",
		writing: "Escribiendo el resumen…",
		failed: "No se pudo escribir el resumen. Inténtalo de nuevo.",
		/** The brief's section headings, which the server writes in English. */
		sections: {
			claims: "Afirmaciones clave",
			caveats: "Ten en cuenta",
			parts: "Partes del texto",
		},
	},
	consent: {
		title: "¿Preguntar a la IA de Anthropic?",
		sent: "Para responder, Klipstack envía a Anthropic el texto del artículo y lo que preguntas sobre él: el pasaje que elegiste y tu pregunta. Anthropic los usa solo para responder y no entrena sus modelos con ellos.",
		when: "No se envía nada hasta que preguntas. Tu elección se aplica en la app en todos tus dispositivos, y puedes cambiarla en Cuenta.",
		privacy: "Política de privacidad",
		failed: "No se pudo guardar tu elección. No se envió nada. Inténtalo de nuevo.",
		continue: "Continuar",
		notNow: "Ahora no",
	},
	left_one: "Te queda {{count}} pregunta este mes",
	left_other: "Te quedan {{count}} preguntas este mes",
	errors: {
		limitReached: "Ya hiciste todas las preguntas que permite este mes. Se reinicia el día 1.",
		limitReachedOn: "Ya hiciste todas las preguntas que permite este mes. Se reinicia el {{date}}.",
		rateLimited: "Demasiadas preguntas seguidas. Espera unos minutos e inténtalo de nuevo.",
		network: "No se pudo conectar con Klipstack. Revisa tu conexión e inténtalo de nuevo.",
		noMatch: "Ese pasaje ya no está en el artículo.",
		ambiguousQuote: "Ese pasaje aparece más de una vez. Selecciona un poco más.",
		notReady: "El artículo se está actualizando. Inténtalo de nuevo en un momento.",
		forbidden: "Las respuestas con IA no están activadas para tu cuenta.",
		unavailable: "Las respuestas con IA no están configuradas en este servidor.",
		tooLarge: "Este artículo es demasiado largo para preguntar sobre él.",
		alreadyPending: "La última pregunta aún se está respondiendo. Inténtalo de nuevo en un minuto.",
		other: "No se pudo responder. Inténtalo de nuevo.",
	},
}
