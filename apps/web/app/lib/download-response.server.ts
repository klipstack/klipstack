/** A file the user downloads, as the `Response` that sends it (built in memory, so it has a length). */
export function downloadResponse(file: {
	body: Uint8Array
	contentType: string
	filename: string
}): Response {
	return new Response(file.body as unknown as BodyInit, {
		headers: {
			"content-type": file.contentType,
			"content-disposition": `attachment; filename="${file.filename}"`,
			"content-length": String(file.body.byteLength),
			"cache-control": "no-store",
		},
	})
}
