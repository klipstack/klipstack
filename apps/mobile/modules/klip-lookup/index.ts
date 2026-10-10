import { requireOptionalNativeModule } from "expo"

const native = requireOptionalNativeModule<{ define(term: string): Promise<void> }>("KlipLookup")

/** Whether this build has the dictionary sheet: iOS only. */
export const canLookUp = native !== null

/** Opens the system dictionary for `term`. Does nothing without it. */
export function lookUp(term: string) {
	return native?.define(term)
}
