import { useTranslation } from "react-i18next"
import { Form, redirect, useNavigation } from "react-router"
import { saveArticle } from "~/commands/saving.server"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { AppError } from "~/lib/app-error"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { saveErrorKey } from "~/lib/save-errors"
import { requireUser } from "~/lib/session.server"
import { refused } from "~/lib/web-action.server"
import type { Route } from "./+types/add"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "library:add.button") }]
}

/** Pull a URL out of share-target params: `url`, or the first http(s) link inside `text`/`title`. */
export function sharedUrl(params: URLSearchParams): string | null {
	const direct = params.get("url")?.trim()
	if (direct && /^https?:\/\//i.test(direct)) return direct
	for (const key of ["text", "title", "url"]) {
		const match = /https?:\/\/[^\s<>"']+/i.exec(params.get(key) ?? "")
		if (match) return match[0]
	}
	return null
}

/** A bookmarklet or PWA share pre-fills the form; saving needs an explicit POST. */
export const handle: PageBarHandle = { pageBar: { titleKey: "library:add.title" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	requireUser(context, request)
	const url = sharedUrl(new URL(request.url).searchParams)
	return { url: url ?? "" }
}

export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const url = String((await readForm(request)).get("url") ?? "").trim()
	let articleId: string
	try {
		articleId = (await saveArticle(user.id, { url, source: "web" })).article.id
	} catch (error) {
		if (error instanceof AppError) return refused(error, { url })
		throw error
	}
	throw redirect(`/read/${articleId}`)
}

export default function Add({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const navigation = useNavigation()
	const error = actionData?.ok === false ? saveErrorKey(actionData.error) : null
	const url = actionData?.url ?? loaderData.url
	return (
		<main className="mx-auto w-full max-w-lg flex-1 px-4 pt-4 pb-12 md:pt-4">
			<h1 className="hidden page-title md:block md:leading-10">{t("add.title")}</h1>
			<p className="mt-2 text-sm text-muted-fg">{t("add.description")}</p>
			<Form method="post" className="mt-6 flex flex-col gap-4">
				<Field
					label="URL"
					name="url"
					type="url"
					inputMode="url"
					required
					autoFocus
					defaultValue={url}
					error={error ? t(error) : undefined}
				/>
				<Button type="submit" disabled={navigation.state !== "idle"}>
					{navigation.state !== "idle" ? t("add.saving") : t("add.submit")}
				</Button>
			</Form>
		</main>
	)
}
