import { isIPv4, isIPv6 } from "node:net"

/**
 * The part of a client address that per-address limits count. An IPv6 client usually holds a
 * whole /64 (2^64 addresses), so its addresses count as their /64, written `a:b:c:d::/64` with
 * each group in lowercase hex without leading zeros. An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`)
 * counts as its IPv4 address. Anything else (an IPv4 address, "unknown") stays as it is.
 */
export function limitAddress(address: string): string {
	if (isIPv4(address)) return address
	const bare = address.replace(/%.*$/, "")
	if (!isIPv6(bare)) return address
	const groups = ipv6Groups(bare.toLowerCase())
	if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff)
		return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join(".")
	return `${groups
		.slice(0, 4)
		.map((g) => g.toString(16))
		.join(":")}::/64`
}

/** The eight 16-bit groups of a valid IPv6 address. */
function ipv6Groups(address: string): number[] {
	let text = address
	// A trailing IPv4 part (`::ffff:1.2.3.4`) is the last two groups.
	const ipv4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text)
	if (ipv4) {
		const [a, b, c, d] = ipv4.slice(1).map(Number) as [number, number, number, number]
		text = `${text.slice(0, ipv4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
	}
	const [head = "", tail] = text.split("::")
	const parse = (part: string) =>
		part === "" ? [] : part.split(":").map((g) => Number.parseInt(g, 16))
	const left = parse(head)
	const right = tail === undefined ? [] : parse(tail)
	return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right]
}
