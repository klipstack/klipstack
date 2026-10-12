import type { Policy, PolicyBlock } from "~/lib/privacy-policy/types"

/** A long legal text (the privacy policy, the terms): title, date, summary, contents, sections. */
export function PolicyDocument({ policy }: { policy: Policy }) {
	return (
		<main className="mx-auto w-full max-w-2xl pt-6 pb-20 sm:pt-10">
			<h1 className="font-serif text-4xl tracking-tight sm:text-5xl">{policy.title}</h1>
			<p className="mt-3 text-sm text-muted-fg">{policy.updated}</p>
			<p className="mt-8 text-lg leading-relaxed">{policy.summary}</p>
			<nav aria-label={policy.contentsLabel} className="mt-10 rounded-xl bg-muted px-6 py-5">
				<h2 className="text-sm font-medium">{policy.contentsLabel}</h2>
				<ol className="mt-3 list-decimal gap-x-10 pl-5 text-sm text-muted-fg sm:columns-2">
					{policy.sections.map((section) => (
						<li key={section.id} className="mb-1.5 break-inside-avoid">
							<a href={`#${section.id}`} className="hover:text-fg hover:underline">
								{section.title}
							</a>
						</li>
					))}
				</ol>
			</nav>
			{policy.sections.map((section, index) => (
				<section key={section.id} id={section.id} className="mt-12 scroll-mt-8">
					<h2 className="font-serif text-2xl tracking-tight">
						<span className="mr-2 text-muted-fg">{index + 1}.</span>
						{section.title}
					</h2>
					<div className="mt-4 space-y-4 leading-relaxed">
						{section.blocks.map((block) => (
							<Block
								key={typeof block === "string" ? block : block.list.join()}
								block={block}
								links={{ [policy.email]: `mailto:${policy.email}`, ...policy.links }}
							/>
						))}
					</div>
				</section>
			))}
		</main>
	)
}

function Block({ block, links }: { block: PolicyBlock; links: Record<string, string> }) {
	if (typeof block === "string") return <p>{withLinks(block, links)}</p>
	return (
		<ul className="list-disc space-y-2 pl-5 marker:text-muted-fg">
			{block.list.map((item) => (
				<li key={item}>{withLinks(item, links)}</li>
			))}
		</ul>
	)
}

/** The phrases of `links` (the contact address, a provider's terms), where the text names them, as links. */
function withLinks(text: string, links: Record<string, string>): React.ReactNode {
	for (const [phrase, href] of Object.entries(links)) {
		const at = text.indexOf(phrase)
		if (at === -1) continue
		const external = !href.startsWith("mailto:")
		return (
			<>
				{withLinks(text.slice(0, at), links)}
				<a
					href={href}
					className="text-link underline underline-offset-2"
					{...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
				>
					{phrase}
				</a>
				{withLinks(text.slice(at + phrase.length), links)}
			</>
		)
	}
	return text
}
