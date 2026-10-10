import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { securityMiddleware } from "./security-middleware.js"

/**
 * Workspace packages are bundled from source, so by default Vite also inlines their node_modules
 * deps (jsdom, pg, the AWS SDK…) into the server bundle, where some break (jsdom reads files via
 * `__dirname`). Externalize them instead. Node then resolves them from apps/web at runtime, so each
 * must also be declared in apps/web/package.json; the check below fails the build otherwise.
 */
function workspaceRuntimeDeps(): string[] {
	const here = import.meta.dirname
	const web = JSON.parse(readFileSync(join(here, "package.json"), "utf8"))
	const packagesDir = join(here, "../../packages")
	const external = new Set<string>()
	for (const name of readdirSync(packagesDir)) {
		const manifest = JSON.parse(readFileSync(join(packagesDir, name, "package.json"), "utf8"))
		for (const dep of Object.keys(manifest.dependencies ?? {})) {
			if (dep.startsWith("@klipstack/")) continue
			if (!web.dependencies?.[dep])
				throw new Error(
					`packages/${name} depends on ${dep}: add it to apps/web/package.json dependencies so the server bundle can resolve it at runtime`,
				)
			external.add(dep)
		}
	}
	return [...external]
}

export default defineConfig({
	plugins: [
		{
			name: "request-security",
			configureServer(server) {
				server.middlewares.use(securityMiddleware)
			},
		},
		tailwindcss(),
		reactRouter(),
	],
	resolve: { tsconfigPaths: true },
	server: { port: 5180, strictPort: true },
	ssr: { external: workspaceRuntimeDeps() },
})
