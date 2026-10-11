import type { Config } from "@react-router/dev/config"

export default {
	ssr: true,
	// Ship the whole route manifest up front: it is tiny, and lazy discovery costs a round trip on
	// the first visit to each route.
	routeDiscovery: { mode: "initial" },
	future: {
		// The dev server pre-bundles what the routes import, lazy chunks included (the edition
		// editor). Otherwise Vite finds those on first use, bundles again and reloads every open
		// page, which breaks whatever a browser test was doing.
		unstable_optimizeDeps: true,
	},
} satisfies Config
