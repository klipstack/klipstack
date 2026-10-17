import { useEffect, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { buttonVariants } from "~/components/ui/button"
import { cn } from "~/lib/utils"

export interface Welcome {
	/** Who signs it (`WELCOME_FROM_*`). */
	name: string
	email: string
	photo: string | null
	/** The reader's first name, or empty. */
	firstName: string
}

/**
 * A new account's first visit to Home: a short note from the person behind Klipstack, in a modal.
 * "Show me around" opens the guide; the other button, Escape or a click outside close it. Either
 * way it does not come back (`POST /welcome`).
 */
export function WelcomeNote({ welcome }: { welcome: Welcome }) {
	const { t } = useTranslation("library")
	const dialogRef = useRef<HTMLDialogElement>(null)
	const fetcher = useFetcher()
	// The reader's choice: the note goes at once, or stays while the guide opens.
	const [choice, setChoice] = useState<"guide" | "explore" | null>(null)

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.open) dialog.showModal()
	}, [])

	// Closed without a choice: it counts as looking around alone.
	const close = () => {
		if (choice) return
		setChoice("explore")
		void fetcher.submit({ intent: "explore" }, { method: "post", action: "/welcome" })
	}

	if (choice === "explore") return null
	const from = t("welcome.from", { name: welcome.name })
	return (
		<dialog
			ref={dialogRef}
			data-testid="welcome-note"
			aria-labelledby="welcome-from"
			className="m-auto w-[min(32rem,92vw)] overflow-hidden rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
			onClose={close}
			onClick={(e) => {
				if (e.target === dialogRef.current) dialogRef.current?.close()
			}}
			onKeyDown={(e) => {
				// The page behind listens for keys on the document: not from here.
				e.stopPropagation()
			}}
		>
			<div className="flex flex-col gap-4 px-6 pt-8 pb-6 sm:px-8">
				<div className="flex flex-col items-center gap-3 text-center">
					{welcome.photo ? (
						<img
							src={welcome.photo}
							alt=""
							width={80}
							height={80}
							className="size-20 rounded-full border border-border object-cover"
						/>
					) : (
						<span
							aria-hidden
							className="flex size-20 items-center justify-center rounded-full bg-accent font-serif text-3xl text-accent-fg"
						>
							{welcome.name.slice(0, 1)}
						</span>
					)}
					<h2 id="welcome-from" className="text-sm text-muted-fg">
						{from}
					</h2>
				</div>
				<p className="font-semibold">
					{welcome.firstName
						? t("welcome.greeting", { firstName: welcome.firstName })
						: t("welcome.greetingNoName")}
				</p>
				<p className="leading-relaxed text-muted-fg">{t("welcome.body")}</p>
				<p className="leading-relaxed text-muted-fg">
					<Trans
						t={t}
						i18nKey="welcome.help"
						components={{
							email: (
								<a
									href={`mailto:${welcome.email}`}
									className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
								>
									{welcome.email}
								</a>
							),
						}}
					/>
				</p>
				<p className="leading-relaxed text-muted-fg">{t("welcome.thanks")}</p>
				<p className="font-serif text-2xl">{welcome.name}</p>
			</div>
			<fetcher.Form
				method="post"
				action="/welcome"
				className="flex flex-col gap-2 border-t border-border bg-muted/40 px-6 py-4 sm:flex-row-reverse sm:px-8"
				onSubmit={(e) => {
					const submitter = (e.nativeEvent as SubmitEvent).submitter
					setChoice(submitter?.getAttribute("value") === "guide" ? "guide" : "explore")
				}}
			>
				<button
					type="submit"
					name="intent"
					value="guide"
					// The modal focuses its first control otherwise: the address, mid-text.
					autoFocus
					disabled={choice !== null}
					className={cn(buttonVariants({ size: "lg" }), "sm:flex-1")}
				>
					{t("welcome.guide")}
				</button>
				<button
					type="submit"
					name="intent"
					value="explore"
					disabled={choice !== null}
					className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "sm:flex-1")}
				>
					{t("welcome.explore")}
				</button>
			</fetcher.Form>
		</dialog>
	)
}
