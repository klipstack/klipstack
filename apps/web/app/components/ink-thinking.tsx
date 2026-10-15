/**
 * While an answer is on its way, in place of a spinner: a short pen stroke beside what is happening
 * ("Thinking…"), drawing itself again and again in the notes' ink (`.ink-stroke` in app.css).
 * Still, and drawn, with reduced motion.
 */
export function InkThinking({ label }: { label: string }) {
	return (
		<p className="flex items-center gap-2 font-serif text-base italic text-muted-fg">
			<svg
				viewBox="0 0 28 12"
				className="ink-stroke h-3 w-7 shrink-0 text-note-fg"
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
