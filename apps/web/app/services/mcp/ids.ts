import { z } from "zod"

/** An article, post or feed id: any case in, lowercase out, as the database writes them. */
export const uuid = () => z.uuid().toLowerCase()
