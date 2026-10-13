// The guardrails of .claude/settings.json, for Amp: both call scripts/agent-hook.mjs, which holds
// the rules. docs/development/agents.md explains them.
import type { PluginAPI } from "@ampcode/plugin"

export const description =
	"Klipstack: asks the agent to run `pnpm verify` before ending a turn that changed code, blocks commits on main, --no-verify and pushes to main that have not passed the checks, and points Ship at the release skill."

export default function (amp: PluginAPI) {
	const root = amp.system.workspaceRoot
		? amp.helpers.filePathFromURI(amp.system.workspaceRoot)
		: null
	if (!root) return
	const hook = `${root}/scripts/agent-hook.mjs`

	amp.on("agent.start", async (event) => {
		await amp.$`cd ${root} && node ${hook} turn-start ${event.thread.id}`
		return {}
	})

	amp.on("agent.end", async (event) => {
		if (event.status !== "done") return
		const result = await amp.$`cd ${root} && node ${hook} turn-end ${event.thread.id}`
		if (result.exitCode !== 2) return
		// One reminder per user message, as Claude Code's stop_hook_active: the agent may stop on
		// purpose, and says why.
		return { action: "continue", userMessage: result.stderr.trim(), maxContinuations: 1 }
	})

	amp.on("tool.call", async (event) => {
		const shell = amp.helpers.shellCommandFromToolCall(event)
		if (!shell) return { action: "allow" }
		const result = await amp.$`cd ${shell.dir ?? root} && node ${hook} guard ${shell.command}`
		if (result.exitCode !== 2) return { action: "allow" }
		return { action: "reject-and-continue", message: result.stderr.trim() }
	})

	amp.on("changes.prompt", async () => ({
		append:
			"This repository releases through .claude/skills/release/SKILL.md: follow it step by step. No pull request: it ends with a push to main. Run `pnpm verify` and the review in .claude/skills/review-changes/SKILL.md before pushing.",
	}))
}
