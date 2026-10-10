import { v7 as uuidv7 } from "uuid"

/** Time-ordered UUID (v7). Safe to generate on the client later. */
export function newId(): string {
	return uuidv7()
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const PUBLIC_ID_LENGTH = 12
// Bytes from 248 (4 × 62) up are dropped: keeping them would make the first 8 characters likelier.
const BYTE_LIMIT = 256 - (256 % 62)

/**
 * An opaque id for a public URL: 12 random base62 characters (71 bits). Unlike `newId`, it tells
 * nothing about when it was made, and nobody can guess it.
 */
export function newPublicId(): string {
	let id = ""
	while (id.length < PUBLIC_ID_LENGTH) {
		for (const byte of crypto.getRandomValues(new Uint8Array(PUBLIC_ID_LENGTH * 2))) {
			if (byte < BYTE_LIMIT) id += BASE62[byte % 62]
			if (id.length === PUBLIC_ID_LENGTH) break
		}
	}
	return id
}
