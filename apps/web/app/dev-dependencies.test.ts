import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { createServer } from "vite"
import { expect, test } from "vitest"

const APP = import.meta.dirname
const ROOT = join(APP, "..")

/** What the browser can load: the app's modules, without server-only code, tests or the route config. */
function clientModules(): string[] {
	return readdirSync(APP, { recursive: true, encoding: "utf8" })
		.filter((file) => /\.tsx?$/.test(file))
		.filter((file) => !/\.(test|server)\.tsx?$/.test(file) && !/(^|\/)test\//.test(file))
		.filter((file) => file !== "routes.ts")
		.map((file) => join(APP, file))
}

/**
 * The dev server bundles the app's dependencies when it starts. One it finds only later, in a lazy
 * chunk the first time a page loads it, makes it bundle again and reload every open page, which
 * breaks whatever a browser test was doing there (`future.unstable_optimizeDeps` in
 * `react-router.config.ts`).
 */
test(
	"the dev server bundles every dependency of the browser's code when it starts",
	{
		timeout: 120_000,
	},
	async () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "klipstack-vite-deps-"))
		const server = await createServer({
			root: ROOT,
			configFile: join(ROOT, "vite.config.ts"),
			cacheDir,
			logLevel: "silent",
			server: { middlewareMode: true, hmr: false, ws: false },
		})
		try {
			const client = server.environments.client
			const optimizer = client.depsOptimizer
			if (!optimizer) throw new Error("the dev server has no dependency optimizer")
			const known = () =>
				new Set([
					...Object.keys(optimizer.metadata.optimized),
					...Object.keys(optimizer.metadata.discovered),
				])
			await (optimizer as { scanProcessing?: Promise<void> }).scanProcessing
			const atStart = known()
			const failed: string[] = []
			for (const file of clientModules()) {
				await client.transformRequest(file).catch(() => failed.push(relative(ROOT, file)))
			}
			expect(failed).toEqual([])
			expect([...known()].filter((dep) => !atStart.has(dep))).toEqual([])
		} finally {
			await server.close()
			rmSync(cacheDir, { recursive: true, force: true })
		}
	},
)
