import type {
	Endpoint,
	InferBody,
	InferParams,
	InferQuery,
	JsonInput,
	JsonStatus,
} from "@klipstack/api-contract"
import type { ApiPrincipal } from "./auth.server"

/** A JSON result with one of the endpoint's other statuses (the first is the default). */
export class Reply<T> {
	constructor(
		readonly status: JsonStatus,
		readonly data: T,
	) {}
}

export const reply = <T>(status: JsonStatus, data: T) => new Reply(status, data)

type Auth<E> = E extends { scope: "none" }
	? { principal: null }
	: { userId: string; access: "read" | "write"; principal: ApiPrincipal }

export type HandlerContext<E> = {
	request: Request
	params: InferParams<E>
	query: InferQuery<E>
	body: InferBody<E>
} & Auth<E>

/** json: the schema's input, or `reply(status, data)` · text: string · binary: Response · empty: void */
export type HandlerResult<E> = E extends { response: { kind: "json" } }
	? JsonInput<E> | Reply<JsonInput<E>>
	: E extends { response: { kind: "text" } }
		? string
		: E extends { response: { kind: "binary" } }
			? Response
			: undefined

export type Handler<E extends Endpoint> = (ctx: HandlerContext<E>) => Promise<HandlerResult<E>>

export type HandlerTable<T extends Record<string, Endpoint>> = { [K in keyof T]: Handler<T[K]> }
