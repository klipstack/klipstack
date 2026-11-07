import { Languages, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { Button } from "~/components/ui/button"
import { useClientValue } from "~/hooks/use-client-value"
import { languageName } from "~/lib/languages"
import { showToast } from "~/lib/toast"
import type { ReaderData } from "~/routes/read"

type Translation = NonNullable<ReaderData["translation"]>

/** "Not now" on an article's offer: not offered again on this device. */
const dismissedKey = (documentId: string) => `klipstack:translation-dismissed:${documentId}`

/** Whether the reader offers to translate the article: in another language, not one they read. */
export function offersTranslation(translation: Translation, neverTranslate: readonly string[]) {
	const { language, target } = translation
	return (
		translation.available &&
		!translation.translated &&
		!translation.status &&
		language !== null &&
		language !== target &&
		!neverTranslate.includes(language)
	)
}

/** The fetcher that asks for a translation, or the original back, and says when it can't. */
export function useTranslationAction(documentId: string) {
	const { t } = useTranslation("reader")
	const fetcher = useFetcher<{ ok: boolean; error?: { code: string } }>()
	useEffect(() => {
		if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok)
			showToast({
				message: t(
					fetcher.data.error?.code === "limit_reached"
						? "translation.noCredits"
						: "translation.error",
				),
			})
	}, [fetcher.state, fetcher.data, t])
	return {
		busy: fetcher.state !== "idle",
		run: (intent: "translate" | "original") =>
			void fetcher.submit(
				{ intent },
				{ method: "post", action: `/documents/${documentId}/translation` },
			),
	}
}

/**
 * Above the article: the offer to translate it, the translation on its way or failed, or, on a
 * translation, where it came from and the switch to the original text and back.
 */
export function ReaderTranslation({
	documentId,
	translation,
	neverTranslate,
}: {
	documentId: string
	translation: Translation
	neverTranslate: readonly string[]
}) {
	const { t, i18n } = useTranslation("reader")
	const name = (code: string | null) => (code ? languageName(code, i18n.language) : "")
	const target = name(translation.target)
	const action = useTranslationAction(documentId)
	const never = useFetcher()
	// Hidden until the browser says it wasn't dismissed: no offer that flashes and goes.
	const stored = useClientValue(() => localStorage.getItem(dismissedKey(documentId)) === "1", true)
	const [dismissedNow, setDismissed] = useState(false)
	const dismissed = stored || dismissedNow

	if (translation.viewingOriginal)
		return (
			<Bar>
				<p>
					{translation.from
						? t("translation.viewingOriginal", { language: name(translation.from) })
						: t("translation.viewingOriginalUnknown")}{" "}
					{t("translation.readOnly")}
					{translation.elsewhere > 0
						? ` ${t("translation.onTranslation", { count: translation.elsewhere })}`
						: null}
				</p>
				<Actions>
					<Link to="." replace preventScrollReset className={linkClass}>
						{t("translation.showTranslation")}
					</Link>
				</Actions>
			</Bar>
		)

	if (translation.translated)
		return (
			<Bar>
				<p>
					{translation.from
						? t("translation.translated", { language: name(translation.from) })
						: t("translation.translatedUnknown")}
					{translation.elsewhere > 0
						? ` ${t("translation.onOriginal", { count: translation.elsewhere })}`
						: null}
					{translation.stale ? ` ${t("translation.stale")}` : null}
				</p>
				<Actions>
					<Link to="?original=1" replace preventScrollReset className={linkClass}>
						{t("translation.showOriginal")}
					</Link>
					{translation.stale && translation.available && translation.status !== "pending" ? (
						<Button
							size="sm"
							variant="secondary"
							disabled={action.busy}
							onClick={() => action.run("translate")}
						>
							{t("translation.translateAgain")}
						</Button>
					) : null}
				</Actions>
			</Bar>
		)

	if (translation.status === "pending")
		return (
			<Bar role="status">
				<p className="flex items-center gap-2">
					<Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
					<span>
						{t("translation.pending", { language: target })} {t("translation.pendingHint")}
					</span>
				</p>
			</Bar>
		)

	if (translation.status === "failed" && translation.available)
		return (
			<Bar>
				<p>{t("translation.failed")}</p>
				<Actions>
					<Button
						size="sm"
						variant="secondary"
						disabled={action.busy}
						onClick={() => action.run("translate")}
					>
						{t("translation.retry")}
					</Button>
				</Actions>
			</Bar>
		)

	if (!offersTranslation(translation, neverTranslate) || dismissed) return null
	const language = name(translation.language)
	const enough = translation.credits <= translation.left
	const notNow = () => {
		localStorage.setItem(dismissedKey(documentId), "1")
		setDismissed(true)
	}
	const neverAgain = () => {
		void never.submit(
			{ language: translation.language!, never: "true" },
			{ method: "post", action: "/translation/never" },
		)
		// Gone at once: the reader's prefs are its own copy until it loads again.
		setDismissed(true)
		showToast({ message: t("translation.neverDone", { language }) })
	}
	return (
		<Bar testId="translation-offer">
			<p>
				{t("translation.offer", { language })}{" "}
				<span className="text-muted-fg">
					{translation.tooLong
						? t("translation.tooLong")
						: translation.credits === 0
							? t("translation.free")
							: `${t(enough ? "translation.cost" : "translation.short", { count: translation.credits })} ${t("translation.creditsLeft", { count: translation.left })}`}
				</span>
			</p>
			<Actions>
				{translation.tooLong ? null : (
					<Button
						size="sm"
						disabled={!enough || action.busy}
						onClick={() => action.run("translate")}
					>
						<Languages className="size-4" aria-hidden />
						{t("translation.translate", { language: target })}
					</Button>
				)}
				<Button size="sm" variant="ghost" onClick={notNow}>
					{t("translation.notNow")}
				</Button>
				<Button size="sm" variant="ghost" disabled={never.state !== "idle"} onClick={neverAgain}>
					{t("translation.never", { language })}
				</Button>
			</Actions>
		</Bar>
	)
}

const linkClass = "text-sm font-medium text-fg underline underline-offset-2 hover:text-link"

function Bar({
	children,
	role,
	testId = "translation-bar",
}: {
	children: React.ReactNode
	role?: "status"
	testId?: string
}) {
	return (
		<div
			role={role}
			data-testid={testId}
			className="mt-6 rounded-lg border border-border/70 bg-fg/[0.03] px-4 py-3 text-sm"
		>
			{children}
		</div>
	)
}

function Actions({ children }: { children: React.ReactNode }) {
	return <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>
}
