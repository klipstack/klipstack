import { parentPort } from "node:worker_threads"
import { extractCapture, extractXPost, X_RAW_CONTENT_TYPE } from "@klipstack/extract"
import type { ParseInput, ParseOutput } from "./parse"
import { serveTasks } from "./thread-pool"

/** A parse thread (./parse.ts): turns a stored capture into an article. */
serveTasks(parentPort, async ({ body, servedHtml, url, contentType }: ParseInput) =>
	contentType === X_RAW_CONTENT_TYPE
		? ({ article: extractXPost(body, url), used: "rendered" } satisfies ParseOutput)
		: extractCapture({ html: body, servedHtml, url }),
)
