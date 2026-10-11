import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { createServer } from "vite"
import { expect, test } from "vitest"

const APP = import.meta.dirname
const ROOT = join(APP, "..")
const REPO = join(ROOT, "../..")

/**
 * Our scripts the browser can load: no server-only code, tests or route config. Not the
 * stylesheet's imports either: Tailwind lists there every file it reads class names from.
 */
const browserSource = (file: string) =>
	/\.(m?js|jsx|tsx?)$/.test(file) &&
	file.startsWith(REPO) &&
	!file.includes("/node_modules/") &&
	!/\.(test|server)\.tsx?$/.test(file) &&
	!file.includes("/test/") &&
	file !== join(APP, "routes.ts")

/** The app's modules the browser can load. */
function clientModules(): string[] {
	return readdirSync(APP, { recursive: true, encoding: "utf8" })
		.map((file) => join(APP, file))
		.filter(browserSource)
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
			// Only what the crawl below loads, not what Vite loads in the background meanwhile.
			server: { middlewareMode: true, hmr: false, ws: false, preTransformRequests: false },
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
			const files = clientModules()
			// A filter that matched nothing would check nothing.
			expect(files.length).toBeGreaterThan(100)
			// Each module and the source it imports, lazily or not, as far as the shared packages:
			// what the browser can load.
			const failed: string[] = []
			const seen = new Set<string>()
			const queue = [...files]
			for (let file = queue.shift(); file; file = queue.shift()) {
				if (seen.has(file)) continue
				seen.add(file)
				if (!(await client.transformRequest(file).catch(() => null))) {
					failed.push(relative(REPO, file))
					continue
				}
				for (const mod of client.moduleGraph.getModulesByFile(file) ?? []) {
					for (const { file: next } of mod.importedModules) {
						if (next && browserSource(next)) queue.push(next)
					}
				}
			}
			expect([...seen].some((file) => file.startsWith(join(REPO, "packages")))).toBe(true)
			expect(failed).toEqual([])
			expect([...known()].filter((dep) => !atStart.has(dep))).toEqual([])
		} finally {
			await server.close()
			rmSync(cacheDir, { recursive: true, force: true })
		}
	},
)
