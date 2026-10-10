/**
 * Browsers cap the bodies of keepalive requests at 64 KiB, in bytes, counted across those still in
 * flight. Under this, a body leaves room for another; a longer one goes out as a normal request.
 */
const KEEPALIVE_MAX_BYTES = 60_000

/** Whether a body may go out with `keepalive`. Measured in UTF-8 bytes, not characters. */
export function fitsKeepalive(body: string): boolean {
	// A UTF-16 unit is at most 3 bytes of UTF-8: most bodies are decided without encoding them.
	if (body.length * 3 < KEEPALIVE_MAX_BYTES) return true
	return new TextEncoder().encode(body).length < KEEPALIVE_MAX_BYTES
}
