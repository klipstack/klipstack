import type { TFunction } from "i18next"
import type { AiThreadWithMessages } from "./ai-threads"

/**
 * A prompt that carries a reader's AI card or chat over to their own assistant, through the MCP
 * server: the article to read with `get_article`, the passage, the questions asked so far (not the
 * answers, which can be long), and how to connect Klipstack if it isn't yet.
 */
export function assistantPrompt(
	t: TFunction<"reader">,
	{
		url,
		article,
		card,
	}: {
		url: string
		article: { id: string; title: string }
		card?: Pick<AiThreadWithMessages, "action" | "exact" | "messages">
	},
) {
	const p = "ai.assistant.prompt"
	const parts = [t(`${p}.article`, { id: article.id, title: article.title })]
	if (card && card.action !== "chat" && card.exact)
		parts.push(
			`${t(`${p}.passage`)}\n\n${card.exact
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n")}`,
		)
	// Explain and Define ask with the passage alone: their first question has no words.
	const asked = (card?.messages ?? []).flatMap((m, i) =>
		m.role !== "user"
			? []
			: m.text
				? [m.text]
				: i === 0 && (card?.action === "explain" || card?.action === "define")
					? [t(`${p}.${card.action}`)]
					: [],
	)
	if (asked.length) parts.push(`${t(`${p}.asked`)}\n${asked.map((q) => `- ${q}`).join("\n")}`)
	if (card) parts.push(t(`${p}.next`))
	parts.push(t(`${p}.setup`, { url }))
	return parts.join("\n\n")
}
