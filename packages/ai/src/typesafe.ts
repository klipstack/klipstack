import type { DecisionQuestion } from "./topics"

/** TypeSafe's Jev: a model that only answers typed questions about a text, with probabilities. */
export const JEV_MODEL = "jev-1.13.0"
const ENDPOINT = "https://api.typesafe.ai/v1/systemone"

export interface DecisionResult {
	/** The probability of yes for each question, by its key. */
	answers: Record<string, number>
	usage: { inputTokens: number; outputTokens: number }
	/** `provider:model`. */
	model: string
}

/** Why Jev could not answer; `retryable` when trying again later may work. */
export class DecisionError extends Error {
	constructor(
		message: string,
		readonly retryable: boolean,
	) {
		super(message)
	}
}

/** Yes/no questions to Jev about one text, answered in one request. */
export async function decide(
	config: { apiKey: string; fetch?: typeof fetch },
	state: string,
	questions: Record<string, DecisionQuestion>,
	signal?: AbortSignal,
): Promise<DecisionResult> {
	const response = await (config.fetch ?? fetch)(ENDPOINT, {
		method: "POST",
		headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
		body: JSON.stringify(decisionBody(state, questions)),
		signal,
	})
	if (!response.ok)
		throw new DecisionError(
			`Jev answered HTTP ${response.status}`,
			response.status === 429 || response.status >= 500,
		)
	const body = (await response.json()) as {
		answers: Record<string, { noul: number }>
		usage: { input_tokens: number; output_tokens: number }
	}
	return {
		answers: Object.fromEntries(Object.entries(body.answers).map(([key, a]) => [key, a.noul])),
		usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens },
		model: `typesafe:${JEV_MODEL}`,
	}
}

/** The request Jev gets: each question a yes/no ("noul") with what yes and no mean. */
export function decisionBody(state: string, questions: Record<string, DecisionQuestion>) {
	return {
		model: JEV_MODEL,
		state,
		questions: Object.fromEntries(
			Object.entries(questions).map(([key, q]) => [
				key,
				{ type: "noul", instructions: q.instructions, criteria: { true: q.yes, false: q.no } },
			]),
		),
	}
}
