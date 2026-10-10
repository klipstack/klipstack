import { AsyncLocalStorage } from "node:async_hooks"
import { db, type Tx } from "@klipstack/db"

const transactions = new AsyncLocalStorage<Tx>()

// The auth adapter must use the invite transaction too: a failed signup rolls back the
// account, session and invite together. Outside signup it uses the ordinary connection pool.
export const authDb = new Proxy(db, {
	get(target, property) {
		const connection = transactions.getStore() ?? target
		const value = Reflect.get(connection, property)
		return typeof value === "function" ? value.bind(connection) : value
	},
})

export function withAuthTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
	return db.transaction((tx) => transactions.run(tx, () => fn(tx)))
}
