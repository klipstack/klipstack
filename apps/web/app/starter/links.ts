import type { StarterLanguage, StarterTopic } from "~/lib/starter-shelves"

/**
 * Starter texts that stay on their authors' sites: the shelves keep a link and what a book shows,
 * and adding one saves the link as any other, so the server fetches it from there. They can be
 * under copyright, as the texts bundled in `texts/` can't. `pnpm --filter @klipstack/web
 * starter-links` fetches each and says whether it still reads well, and how long it takes.
 */
export type StarterLink = {
	slug: string
	language: StarterLanguage
	topic: StarterTopic
	url: string
	title: string
	author: string
	/** A line of our own about it, not the site's. */
	description: string
	/** As the check measured it. */
	minutes: number
}

export const STARTER_LINKS: readonly StarterLink[] = [
	{
		slug: "graham-great-work",
		language: "en",
		topic: "ideas",
		url: "https://paulgraham.com/greatwork.html",
		title: "How to Do Great Work",
		author: "Paul Graham",
		description:
			"Paul Graham's 2023 essay on how to choose work and do it so well that it matters: curiosity, delight and the will to do something impressive.",
		minutes: 51,
	},
	{
		slug: "graham-do-things-that-dont-scale",
		language: "en",
		topic: "ideas",
		url: "https://paulgraham.com/ds.html",
		title: "Do Things that Don't Scale",
		author: "Paul Graham",
		description:
			"Paul Graham's 2013 advice to founders: recruit users by hand and delight them one by one before trying to grow.",
		minutes: 19,
	},
	{
		slug: "graham-age-of-the-essay",
		language: "en",
		topic: "reading",
		url: "https://paulgraham.com/essay.html",
		title: "The Age of the Essay",
		author: "Paul Graham",
		description:
			"Paul Graham's 2004 essay on why school teaches essays wrong, and what an essay really is: an attempt to find something out.",
		minutes: 20,
	},
	{
		slug: "graham-think-for-yourself",
		language: "en",
		topic: "living",
		url: "https://paulgraham.com/think.html",
		title: "How to Think for Yourself",
		author: "Paul Graham",
		description:
			"Paul Graham's 2020 essay on independent-mindedness: which kinds of work need it, and how to cultivate it.",
		minutes: 15,
	},
	{
		slug: "orwell-politics-english-language",
		language: "en",
		topic: "reading",
		url: "https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/politics-and-the-english-language/",
		title: "Politics and the English Language",
		author: "George Orwell",
		description:
			"George Orwell's 1946 essay on how vague, borrowed language hides muddled thinking, with six rules for writing plainly.",
		minutes: 24,
	},
	{
		slug: "orwell-why-i-write",
		language: "en",
		topic: "reading",
		url: "https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/why-i-write/",
		title: "Why I Write",
		author: "George Orwell",
		description:
			"George Orwell's 1946 account of his four motives for writing, and how politics came to shape his work.",
		minutes: 12,
	},
	{
		slug: "orwell-shooting-an-elephant",
		language: "en",
		topic: "society",
		url: "https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/shooting-an-elephant/",
		title: "Shooting an Elephant",
		author: "George Orwell",
		description:
			"George Orwell's 1936 account of shooting an elephant as a police officer in colonial Burma, to avoid looking a fool.",
		minutes: 15,
	},
	{
		slug: "ceglowski-website-obesity",
		language: "en",
		topic: "ideas",
		url: "https://idlewords.com/talks/website_obesity.htm",
		title: "The Website Obesity Crisis",
		author: "Maciej Cegłowski",
		description:
			"Maciej Cegłowski's 2015 talk on why web pages have grown so heavy, and what that costs the people who read them.",
		minutes: 33,
	},
	{
		slug: "ceglowski-haunted-by-data",
		language: "en",
		topic: "ideas",
		url: "https://idlewords.com/talks/haunted_by_data.htm",
		title: "Haunted by Data",
		author: "Maciej Cegłowski",
		description:
			"Maciej Cegłowski's 2015 talk arguing that collected data is a lasting liability, comparing it to nuclear waste.",
		minutes: 12,
	},
	{
		slug: "graham-makers-schedule",
		language: "en",
		topic: "ideas",
		url: "https://paulgraham.com/makersschedule.html",
		title: "Maker's Schedule, Manager's Schedule",
		author: "Paul Graham",
		description:
			"Paul Graham's 2009 essay on why a single meeting can wreck a programmer's or writer's afternoon, and how the two kinds of schedule can coexist.",
		minutes: 5,
	},
	{
		slug: "kelly-1000-true-fans",
		language: "en",
		topic: "ideas",
		url: "https://kk.org/thetechnium/1000-true-fans/",
		title: "1,000 True Fans",
		author: "Kevin Kelly",
		description:
			"Kevin Kelly's 2008 essay arguing that a creator needs not millions of buyers, only a thousand people who will buy anything they make.",
		minutes: 19,
	},
	{
		slug: "altman-how-to-be-successful",
		language: "en",
		topic: "ideas",
		url: "https://blog.samaltman.com/how-to-be-successful",
		title: "How To Be Successful",
		author: "Sam Altman",
		description:
			"Sam Altman's 2019 list of thirteen things he has seen the most successful founders do.",
		minutes: 15,
	},
	{
		slug: "housel-psychology-of-money",
		language: "en",
		topic: "living",
		url: "https://collabfund.com/blog/the-psychology-of-money/",
		title: "The Psychology of Money",
		author: "Morgan Housel",
		description:
			"Morgan Housel's 2018 essay on twenty flaws, biases and causes of bad behavior people show with money.",
		minutes: 34,
	},
	{
		slug: "feynman-cargo-cult-science",
		language: "en",
		topic: "science",
		url: "https://calteches.library.caltech.edu/51/2/CargoCult.htm",
		title: "Cargo Cult Science",
		author: "Richard Feynman",
		description:
			"Richard Feynman's 1974 Caltech commencement address on scientific integrity: not fooling yourself, the easiest person to fool.",
		minutes: 17,
	},
	{
		slug: "vargas-llosa-civilizacion-del-espectaculo",
		language: "es",
		topic: "ideas",
		url: "https://letraslibres.com/revista-espana/la-civilizacion-del-espectaculo/",
		title: "La civilización del espectáculo",
		author: "Mario Vargas Llosa",
		description:
			"El ensayo de 2008 que luego dio nombre a su libro: sostiene que el entretenimiento se ha vuelto el valor supremo de nuestra época y que con él se banalizan la cultura, la prensa y la política.",
		minutes: 32,
	},
	{
		slug: "zaid-cultura",
		language: "es",
		topic: "ideas",
		url: "https://letraslibres.com/revista/cultura/",
		title: "Cultura",
		author: "Gabriel Zaid",
		description:
			"Zaid sigue la palabra «cultura» desde la paideia griega hasta hoy y separa sus dos sentidos modernos: el de una cultura universal que progresa y el romántico, en el que cada pueblo tiene la suya.",
		minutes: 14,
	},
	{
		slug: "savater-como-se-hacen-las-ideas-filosoficas",
		language: "es",
		topic: "ideas",
		url: "https://letraslibres.com/revista-espana/como-se-hacen-las-ideas-filosoficas/",
		title: "Cómo se hacen las ideas filosóficas",
		author: "Fernando Savater",
		description:
			"Un texto breve de Savater sobre el oficio de pensar: cómo la abstracción separa lo que estaba junto, lo que Hegel llamó «el trabajo de la muerte», para llegar a una idea.",
		minutes: 7,
	},
	{
		slug: "villoro-quijote-lectura-fronteriza",
		language: "es",
		topic: "reading",
		url: "https://letraslibres.com/revista-espana/el-quijote-una-lectura-fronteriza/",
		title: "El Quijote, una lectura fronteriza",
		author: "Juan Villoro",
		description:
			"Conferencia de 2005 en la que Villoro lee el Quijote como un libro que se construye al ser leído y muestra cómo de esa frontera entre leer y vivir nació la novela moderna.",
		minutes: 31,
	},
	{
		slug: "garcia-marquez-mejor-oficio-del-mundo",
		language: "es",
		topic: "reading",
		url: "https://fundaciongabo.org/es/recursos/discursos/el-mejor-oficio-del-mundo-discurso-de-gabriel-garcia-marquez-ante-la-sip",
		title: "El mejor oficio del mundo",
		author: "Gabriel García Márquez",
		description:
			"Discurso de 1996 ante la Sociedad Interamericana de Prensa: defiende el periodismo escrito como un género literario que se aprende en la redacción y advierte contra la grabadora y el culto a la primicia.",
		minutes: 12,
	},
	{
		slug: "villoro-confianza",
		language: "es",
		topic: "stories",
		url: "https://letraslibres.com/revista-espana/confianza-cuento/",
		title: "Confianza",
		author: "Juan Villoro",
		description:
			"Un cuento de 2010 que empieza en un avión, con un narrador hechizado por el pie de una desconocida, y acaba hablando de lo que no cabe en los datos: la confianza.",
		minutes: 23,
	},
	{
		slug: "cota-hiriart-wallace",
		language: "es",
		topic: "science",
		url: "https://www.revistadelauniversidad.mx/articles/1f3c1376-39cb-4609-afff-49261634ca81/alfred-russel-wallace-el-otro-padre-de-la-evolucion",
		title: "Alfred Russel Wallace, el otro padre de la evolución",
		author: "Andrés Cota Hiriart",
		description:
			"La historia del naturalista que, desde el archipiélago malayo, llegó por su cuenta a la selección natural y obligó a Darwin a publicar: un caso insólito de dos mentes que dieron con la misma idea.",
		minutes: 7,
	},
	{
		slug: "cercas-el-hombre-que-dice-no",
		language: "es",
		topic: "society",
		url: "https://letraslibres.com/revista-espana/el-hombre-que-dice-no/",
		title: "El hombre que dice no",
		author: "Javier Cercas",
		description:
			"Ensayo de 2015 que mezcla reflexión y experiencia propia para preguntarse qué le debe un escritor a la política, y que sitúa el compromiso del intelectual en la responsabilidad de cualquier ciudadano.",
		minutes: 31,
	},
]
