import { CONTROLLER, type Policy, SUPPORT_CONTACT } from "../privacy-policy/types"

export default {
	title: "Términos de uso",
	updated: "Última actualización: 5 de octubre de 2026",
	summary:
		"Estas son las reglas para usar Klipstack. En resumen: lo que guardas es tuyo y es privado, lo que publicas debe ser legal y justo con los demás, cada cuenta tiene límites, y podemos retirar lo que no cumpla estas reglas.",
	contentsLabel: "En esta página",
	email: SUPPORT_CONTACT,
	sections: [
		{
			id: "service",
			title: "El servicio",
			blocks: [
				`Klipstack te permite guardar páginas web, leerlas, subrayarlas y tomar notas, y publicar ediciones: páginas públicas de lo que lees. Es propiedad de ${CONTROLLER} ("nosotros"), una empresa chilena, que también lo opera.`,
				// TODO: pricing is not decided. Add payment, renewal and refund terms before charging anyone.
				"Klipstack es joven. Por ahora es gratis, puede cambiar y puede tener errores. Si alguna vez lo cerramos, te avisaremos al menos 30 días antes, para que puedas descargar tu biblioteca.",
				`Preguntas sobre estos términos: ${SUPPORT_CONTACT}.`,
			],
		},
		{
			id: "account",
			title: "Tu cuenta",
			blocks: [
				{
					list: [
						"Debes tener 16 años o más.",
						"Una persona por cuenta. Cuida tu acceso; lo que pase en tu cuenta es tu responsabilidad.",
						"Usa un correo que leas: ahí enviamos enlaces de inicio de sesión y avisos importantes.",
					],
				},
			],
		},
		{
			id: "content",
			title: "Lo que guardas",
			blocks: [
				"Lo que guardas, subrayas y escribes sigue siendo tuyo. Nos permites guardarlo y procesarlo solo para hacer funcionar Klipstack para ti. Tu biblioteca es privada: solo tú la ves.",
				"Guardar una página guarda una copia personal para tu lectura. Respeta los derechos de los sitios que guardas: no republiques su contenido a través de Klipstack.",
			],
		},
		{
			id: "editions",
			title: "Ediciones públicas",
			blocks: [
				"Una edición que publicas la puede leer cualquiera que tenga su enlace. Nos permites mostrársela. Enlaza a los artículos y puede citar pasajes breves; nunca los republica.",
				"Una edición no debe contener:",
				{
					list: [
						"Nada ilegal, ni enlaces a algo ilegal.",
						"Spam, estafas o contenido engañoso.",
						"Obras de otras personas sin su permiso, más allá de citas breves.",
						"Acoso, amenazas u odio contra personas o grupos.",
						"Malware, phishing, ni enlaces a ellos.",
						"Datos personales de otras personas sin su consentimiento.",
					],
				},
			],
		},
		{
			id: "limits",
			title: "Límites",
			blocks: [
				"Cada cuenta tiene límites: artículos guardados al mes, almacenamiento, feeds que sigues y ediciones publicadas al mes. En Ajustes ves los tuyos y cuánto usas. También hay límites a la rapidez con que puedes guardar o usar la API.",
				"Podemos cambiar los límites. No los esquives, por ejemplo con varias cuentas o con scripts.",
			],
		},
		{
			id: "use",
			title: "Uso justo",
			blocks: [
				{
					list: [
						"No uses Klipstack para incumplir la ley ni para dañar a otros.",
						"No ataques, sobrecargues ni sondees Klipstack, y no intentes llegar a los datos de otras personas.",
						"No revendas Klipstack ni lo uses para descargar páginas para otros a gran escala.",
					],
				},
			],
		},
		{
			id: "reports",
			title: "Denuncias y retiros",
			blocks: [
				'Cualquiera puede denunciar una edición pública con "Denunciar esta página". Una persona lee cada denuncia; una denuncia sola no retira nada.',
				"Si una edición incumple estos términos, podemos retirarla. Te escribimos por qué. Una edición retirada no se puede volver a publicar, salvo que la restauremos.",
				`Si crees que nos equivocamos, escribe a ${SUPPORT_CONTACT}. La revisaremos de nuevo.`,
				"Ante incumplimientos graves o repetidos, podemos cerrar la cuenta. Cuando sea razonable, te avisamos antes.",
			],
		},
		{
			id: "ending",
			title: "Irte",
			blocks: [
				"Puedes descargar tu biblioteca y borrar tu cuenta cuando quieras, en Ajustes. Borrarla borra tus datos, como explica la política de privacidad.",
			],
		},
		{
			id: "liability",
			title: "Sin garantías",
			blocks: [
				"Trabajamos para que Klipstack funcione y tus datos estén seguros, pero lo ofrecemos tal cual, sin garantías. Guarda tu propia copia de lo importante: en Ajustes puedes descargarlo todo.",
				"En la medida en que la ley lo permite, no respondemos por pérdidas indirectas, ni por pérdidas de un servicio que recibes gratis. Nada en estos términos limita los derechos que te da la ley de protección al consumidor.",
			],
		},
		{
			id: "changes",
			title: "Cambios en estos términos",
			blocks: [
				"Cuando estos términos cambian, actualizamos la fecha de arriba. Si el cambio es importante, te escribimos antes de que se aplique. Si sigues usando Klipstack después, se aplican los nuevos términos.",
			],
		},
		{
			id: "law",
			title: "Ley aplicable",
			blocks: [
				"Estos términos se rigen por la ley chilena. Las disputas van a los tribunales de Chile, salvo que la ley de protección al consumidor te dé derecho a acudir a otros.",
			],
		},
	],
} satisfies Policy
