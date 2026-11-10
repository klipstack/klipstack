import { describe, expect, test } from "vitest"
import { can, extractionMachine, type Machine, topicMachine, translationMachine } from "./machines"

const machines: [string, Machine<unknown, string>][] = [
	["extraction", extractionMachine],
	["translation", translationMachine],
	["topic", topicMachine],
]

describe.each(machines)("the %s machine", (_, m) => {
	test("reaches every state its column can hold", () => {
		const reached = new Set(Object.values(m.transitions).map((t) => t.to))
		expect(m.states.filter((s) => !reached.has(s))).toEqual([])
	})

	test("starts each row in a state, by a transition with no `from`", () => {
		expect(Object.values(m.transitions).some((t) => t.from.length === 0)).toBe(true)
	})
})

test("can answers from the transitions", () => {
	expect(can(extractionMachine, "retry", "failed")).toBe(true)
	expect(can(extractionMachine, "retry", "ready")).toBe(false)
	expect(can(translationMachine, "request", "failed")).toBe(true)
	expect(can(translationMachine, "request", "pending")).toBe(false)
	expect(can(topicMachine, "remove", "proposed")).toBe(false)
})
