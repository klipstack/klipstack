import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

/** Version of an installed package, resolved from one of its entry points (exports-safe). */
export function packageVersion(entry: string, name: string): string {
	try {
		const require = createRequire(import.meta.url)
		let dir = dirname(require.resolve(entry))
		for (let i = 0; i < 6; i++) {
			const candidate = join(dir, "package.json")
			if (existsSync(candidate)) {
				const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
					name?: string
					version?: string
				}
				if (pkg.name === name && pkg.version) return pkg.version
			}
			const parent = dirname(dir)
			if (parent === dir) break
			dir = parent
		}
	} catch {
		// fall through
	}
	return "unknown"
}
