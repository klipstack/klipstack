import { customType } from "drizzle-orm/pg-core"

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType() {
		return "bytea"
	},
})

export const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector"
	},
})
