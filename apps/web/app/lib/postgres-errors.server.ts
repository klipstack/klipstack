/** Postgres' unique_violation, as thrown directly or wrapped by Drizzle. */
export function isUniqueViolation(error: unknown): boolean {
	const code = (e: unknown) =>
		e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined
	return (
		code(error) === "23505" ||
		(error instanceof Error && code((error as Error & { cause?: unknown }).cause) === "23505")
	)
}
