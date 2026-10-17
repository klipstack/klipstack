import { Copy, Download, Image as ImageIcon, Share } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { showToast } from "~/lib/toast"
import { Button, buttonVariants } from "./ui/button"

type Shape = "wide" | "tall"

/** The picture as drawn, or why it is not: still drawing, a script the fonts lack, a failure. */
type Drawn =
	| { state: "drawing" }
	| { state: "ready"; blob: Blob; url: string }
	| { state: "undrawable" | "failed" }

/** The highlight's picture in a shape, drawn by the server; the latest asked for wins. */
function useDrawn(src: string): Drawn {
	const [drawn, setDrawn] = useState<{ src: string; drawn: Drawn } | null>(null)
	useEffect(() => {
		let live = true
		let url: string | null = null
		fetch(src)
			.then(async (r) => {
				if (r.status === 422) return { state: "undrawable" } as const
				if (!r.ok) return { state: "failed" } as const
				const blob = await r.blob()
				url = URL.createObjectURL(blob)
				return { state: "ready", blob, url } as const
			})
			.catch(() => ({ state: "failed" }) as const)
			.then((d) => {
				if (live) setDrawn({ src, drawn: d })
				else if (url) URL.revokeObjectURL(url)
			})
		return () => {
			live = false
			if (url) URL.revokeObjectURL(url)
		}
	}, [src])
	return drawn?.src === src ? drawn.drawn : { state: "drawing" }
}

/**
 * The highlight as a picture to send by itself: wide for chats and posts, tall for a phone's full
 * screen. On a phone it goes to the share sheet with the picture attached; on a computer it is
 * downloaded or copied. It needs no public link: it is the highlight as it is now.
 */
export function ShareHighlightImage({ id, withNote }: { id: string; withNote: boolean }) {
	const { t } = useTranslation("reader")
	const [shape, setShape] = useState<Shape>("wide")
	const src = `/highlights/${id}/image.png?shape=${shape}&note=${withNote ? 1 : 0}`
	const drawn = useDrawn(src)
	const name = `klipstack-highlight-${shape}.png`
	const file = drawn.state === "ready" ? new File([drawn.blob], name, { type: "image/png" }) : null
	const canShareFile =
		file !== null &&
		typeof navigator.canShare === "function" &&
		navigator.canShare({ files: [file] })
	const canCopy =
		typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function"

	const copy = (blob: Blob) =>
		void navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
			() => showToast({ message: t("highlights.share.image.copied") }),
			() => showToast({ message: t("highlights.share.image.copyFailed"), warn: true }),
		)

	return (
		<section
			aria-label={t("highlights.share.image.label")}
			data-testid="share-image"
			className="flex flex-col gap-3 rounded-xl border border-border p-4"
		>
			<div className="flex items-center justify-between gap-3">
				<h3 className="flex items-center gap-2 text-sm font-medium">
					<ImageIcon className="size-4" aria-hidden />
					{t("highlights.share.image.label")}
				</h3>
				<div
					role="radiogroup"
					aria-label={t("highlights.share.image.shape")}
					className="flex rounded-lg border border-border p-0.5 text-xs"
				>
					{(["wide", "tall"] as const).map((s) => (
						<button
							key={s}
							type="button"
							role="radio"
							aria-checked={shape === s}
							onClick={() => setShape(s)}
							className={`rounded-md px-2.5 py-1 ${shape === s ? "bg-hover font-medium text-fg" : "text-muted-fg hover:text-fg"}`}
						>
							{t(`highlights.share.image.${s}`)}
						</button>
					))}
				</div>
			</div>
			<p className="text-xs text-muted-fg">{t(`highlights.share.image.${shape}Hint`)}</p>
			<div className="flex h-56 items-center justify-center rounded-lg bg-hover/60 p-2">
				{drawn.state === "ready" ? (
					<img
						src={drawn.url}
						alt={t("highlights.share.image.alt")}
						className="max-h-full max-w-full rounded shadow-sm"
					/>
				) : (
					<p className="px-4 text-center text-sm text-muted-fg" role="status">
						{t(
							drawn.state === "drawing"
								? "highlights.share.image.drawing"
								: drawn.state === "undrawable"
									? "highlights.share.image.undrawable"
									: "highlights.share.image.failed",
						)}
					</p>
				)}
			</div>
			{drawn.state === "ready" ? (
				<div className="flex flex-wrap gap-2">
					{canShareFile && file ? (
						<Button
							size="sm"
							onClick={() => void navigator.share({ files: [file] }).catch(() => {})}
						>
							<Share className="size-4" aria-hidden />
							{t("highlights.share.image.share")}
						</Button>
					) : null}
					<a
						href={drawn.url}
						download={name}
						className={buttonVariants({
							size: "sm",
							variant: canShareFile ? "secondary" : "primary",
						})}
					>
						<Download className="size-4" aria-hidden />
						{t("highlights.share.image.download")}
					</a>
					{canCopy ? (
						<Button size="sm" variant="secondary" onClick={() => copy(drawn.blob)}>
							<Copy className="size-4" aria-hidden />
							{t("highlights.share.image.copy")}
						</Button>
					) : null}
				</div>
			) : null}
		</section>
	)
}
