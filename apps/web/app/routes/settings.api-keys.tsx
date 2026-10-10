import { Copy, KeyRound, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { createApiKey, revokeApiKey } from "~/commands/account.server"
import { SettingsCard, SettingsPage, SignInAgain } from "~/components/settings-page"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { useMutationQueue } from "~/hooks/use-mutation-queue"
import { AppError } from "~/lib/app-error"
import { formatDay, timeZoneFromCookie } from "~/lib/date-groups"
import { getLocale } from "~/lib/i18n.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { getSession, requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { WebResult } from "~/lib/web-result"
import { listApiKeys } from "~/services/api-keys.server"
import type { Route } from "./+types/settings.api-keys"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:apiKeys.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:apiKeys.title" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const locale = getLocale(context)
	const zone = timeZoneFromCookie(request.headers.get("cookie"))
	const keys = await listApiKeys(user.id)
	return {
		emailVerified: user.emailVerified,
		keys: keys.map((k) => ({
			...k,
			lastUsed: k.lastUsedAt ? formatDay(k.lastUsedAt, locale, zone) : null,
		})),
	}
}

/** POST /settings/api-keys  intent=create|revoke. A created key is returned once. */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const field = (name: string) => String(form.get(name) ?? "")
	return answer(async () => {
		switch (form.get("intent")) {
			case "create":
				return {
					created: await createApiKey(user.id, {
						name: field("name"),
						signedInAt: getSession(context)?.session.createdAt,
					}),
				}
			case "revoke":
				await revokeApiKey(user.id, field("id"))
				return { revoked: field("id") }
			default:
				throw new AppError("invalid_request", "Unknown intent.")
		}
	})
}

export default function ApiKeysSettings({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	// Key changes go one at a time: a revoke never cancels a key being made, nor another revoke.
	const [created, setCreated] = useState<{ id: string; raw: string } | null>(null)
	const [keysError, setKeysError] = useState<string | null>(null)
	const keys = useMutationQueue<
		{ intent: "create"; name: string } | { intent: "revoke"; id: string },
		WebResult<{ created?: { id: string; raw: string } }>
	>({
		action: "/settings/api-keys",
		body: (change) => change,
		onSettled: (_change, answer) => {
			if (!answer?.ok) setKeysError(answer?.error.code ?? "network")
			else if (answer.created) setCreated(answer.created)
		},
	})
	const changeKeys = (change: Parameters<typeof keys.submit>[0]) => {
		setKeysError(null)
		keys.submit(change)
	}
	const creating = keys.pending.some((c) => c.intent === "create")
	const revoking = new Set(keys.pending.flatMap((c) => (c.intent === "revoke" ? [c.id] : [])))
	// "Copied" belongs to the key it copied, not to the next one made.
	const [copied, setCopied] = useState<string | null>(null)

	return (
		<SettingsPage title={t("apiKeys.title")} description={t("apiKeys.description")}>
			<SettingsCard>
				{!loaderData.emailVerified ? (
					<p className="mb-4 text-sm text-muted-fg">
						{t("apiKeys.verificationRequired")}{" "}
						<Link to="/settings/account" className="text-link hover:underline">
							{t("apiKeys.verifyLink")}
						</Link>
					</p>
				) : null}
				{keysError ? (
					keysError === "reauthentication_required" ? (
						<SignInAgain />
					) : (
						<p role="alert">{t("apiKeys.requestFailed")}</p>
					)
				) : null}
				<form
					method="post"
					action="/settings/api-keys"
					onSubmit={(e) => {
						e.preventDefault()
						const name = String(new FormData(e.currentTarget).get("name") ?? "")
						changeKeys({ intent: "create", name })
					}}
					className="flex gap-2"
				>
					<input type="hidden" name="intent" value="create" />
					<Input
						name="name"
						placeholder={t("apiKeys.namePlaceholder")}
						required
						maxLength={60}
						aria-label={t("apiKeys.namePlaceholder")}
					/>
					<Button
						type="submit"
						variant="secondary"
						disabled={creating || !loaderData.emailVerified}
					>
						<KeyRound className="size-4" aria-hidden />
						{t("apiKeys.create")}
					</Button>
				</form>
				{created ? (
					<div className="mt-4 rounded-lg border border-accent/40 bg-muted p-3" role="status">
						<p className="text-sm">{t("apiKeys.created")}</p>
						<div className="mt-2 flex items-center gap-2">
							<code
								data-testid="new-api-key"
								className="flex-1 overflow-x-auto rounded bg-card px-2 py-1 text-sm"
							>
								{created.raw}
							</code>
							<Button
								type="button"
								size="sm"
								variant="secondary"
								onClick={() => {
									void navigator.clipboard?.writeText(created.raw).then(() => setCopied(created.id))
								}}
							>
								<Copy className="size-4" aria-hidden />
								{copied === created.id ? t("apiKeys.copied") : t("apiKeys.copy")}
							</Button>
						</div>
					</div>
				) : null}
				<ul className="mt-4 divide-y divide-border">
					{loaderData.keys.length === 0 ? (
						<li className="py-2 text-sm text-muted-fg">{t("apiKeys.empty")}</li>
					) : null}
					{loaderData.keys.map((k) => (
						<li
							key={k.id}
							className={`flex items-center justify-between gap-3 py-2 ${revoking.has(k.id) ? "opacity-40" : ""}`}
						>
							<div className="min-w-0">
								<p className="truncate text-sm font-medium">{k.name}</p>
								<p className="text-xs text-muted-fg">
									<code>{k.prefix}…</code> ·{" "}
									{k.lastUsed
										? t("apiKeys.lastUsed", { date: k.lastUsed })
										: t("apiKeys.neverUsed")}
								</p>
							</div>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								aria-label={`${t("apiKeys.revoke")} ${k.name}`}
								onClick={() => {
									if (confirm(t("apiKeys.revokeConfirm")))
										changeKeys({ intent: "revoke", id: k.id })
								}}
							>
								<Trash2 className="size-4" aria-hidden />
								{t("apiKeys.revoke")}
							</Button>
						</li>
					))}
				</ul>
			</SettingsCard>
		</SettingsPage>
	)
}
