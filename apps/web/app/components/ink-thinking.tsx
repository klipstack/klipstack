import { cn } from "~/lib/utils"

/**
 * While an answer is on its way, in place of a spinner: a short pen stroke beside what is happening
 * ("Thinking…"), drawing itself again and again in the notes' ink (`.ink-stroke` in app.css).
 * Sized to its text, which the container sets. Still, and drawn, with reduced motion.
 */
export function InkThinking({ label, className }: { label: string; className?: string }) {
	return (
		<p className={cn("flex items-center gap-[0.5em] text-muted-fg", className)}>
			<svg
				viewBox="0 0 28 12"
				className="ink-stroke h-[0.75em] w-[1.75em] shrink-0 text-note-fg"
				fill="none"
				aria-hidden
			>
				<path
					d="M2 8.5c2.6-2.4 4.6-2.6 6.4-.6s3.6 2 6-.4 4.4-2.6 6.4-.8c1.4 1.2 2.8 1.3 5.2.1"
					pathLength={1}
				/>
			</svg>
			{label}
		</p>
	)
}
