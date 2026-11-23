import { closeParsePool, warmParsePool } from "../src/parse"

/**
 * Parses a small page on a parse thread and exits 0: the image smoke test (scripts/image-smoke)
 * runs it, so a thread that cannot load its code in the production image fails before a release.
 */
await warmParsePool()
await closeParsePool()
console.log("parse thread ok")
