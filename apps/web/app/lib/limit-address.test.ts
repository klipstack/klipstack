import { expect, it } from "vitest"
import { limitAddress } from "./limit-address"

it.each([
	["192.0.2.1", "192.0.2.1"],
	["::ffff:192.0.2.1", "192.0.2.1"],
	["::FFFF:c000:0201", "192.0.2.1"],
	["0:0:0:0:0:ffff:192.0.2.1", "192.0.2.1"],
	["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
	["2001:0DB8:0001:0002::1", "2001:db8:1:2::/64"],
	["2001:db8::1", "2001:db8:0:0::/64"],
	["fe80::1%eth0", "fe80:0:0:0::/64"],
	["::1", "0:0:0:0::/64"],
	["::", "0:0:0:0::/64"],
	["2001:db8:1:2::192.0.2.1", "2001:db8:1:2::/64"],
	["unknown", "unknown"],
	["test-abc", "test-abc"],
	["", ""],
])("limits %s as %s", (address, expected) => {
	expect(limitAddress(address)).toBe(expected)
})
