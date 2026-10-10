import { pool } from "@klipstack/db"
import { createInvite } from "../app/lib/invites.server"

const note = process.argv[2]
const code = await createInvite({ note })
console.log(code)
await pool.end()
