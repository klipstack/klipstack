import type { Config } from "@react-router/dev/config"

export default {
	ssr: true,
	// Ship the whole route manifest up front: it is tiny, and lazy discovery costs a round trip on
	// the first visit to each route.
	routeDiscovery: { mode: "initial" },
} satisfies Config
