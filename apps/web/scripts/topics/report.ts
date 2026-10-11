import type { Article, Assignment, MaintenanceOp, RunResult, SimEvent, Topic } from "./engine"
import type { CallRecord } from "./models"

export interface ReportRun extends RunResult {
	calls: CallRecord[]
}

/** Every article sorted by both classifiers into the same topics: one run's final ones. */
export interface Comparison {
	run: string
	topics: Topic[]
	scores: Record<"jev" | "haiku", Record<string, Record<string, number>>>
	calls: CallRecord[]
}

/** The page around the report when no template is given: plain, with the colors the report uses. */
export const PLAIN_TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title></title>
<style>
:root { --text: #1b1f24; --muted: #5b6370; --line: #d8dce2; --border: #d8dce2; --surface: #f5f6f8; --bg: #fff; --accent: #2f5fd0; --accent-soft: #eaf0fd; --ok: #1d7a46; --bad: #b42318; --warn: #a86b00; }
body { font: 16px/1.5 system-ui, sans-serif; color: var(--text); max-width: 72rem; margin: 2rem auto; padding: 0 1rem; }
table { border-collapse: collapse; width: 100%; } td, th { border-top: 1px solid var(--line); padding: 0.3rem; text-align: left; }
.toc { display: none; }
</style></head>
<body><script></script></body></html>`

/**
 * The report of every run, as one page: the page template's head and script around sections built
 * from the runs. `notes` (header, summary, findings) is written by hand and goes first.
 */
export function writeReport(
	corpus: Article[],
	runs: ReportRun[],
	options: {
		template: string
		notes: string
		title: string
		comparison?: Comparison
		/** Every saved run, for the table of runs and the tries at the first topics. */
		all: ReportRun[]
	},
): string {
	const head = options.template
		.slice(0, options.template.indexOf("<body>"))
		.replace(/<title>[^<]*<\/title>/, `<title>${esc(options.title)}</title>`)
	const script = options.template.slice(options.template.lastIndexOf("<script>"))
	const byId = new Map(corpus.map((a) => [a.id, a]))
	const body = [
		options.notes,
		ladder(options.all, corpus.length),
		stability(options.all),
		coverage(runs),
		history(runs, byId),
		options.comparison ? compare(options.comparison, corpus) : "",
		thresholds(runs, corpus),
		articles(runs, corpus),
		costs(runs, corpus.length),
	].join("\n")
	return `${head}<body>
<div class="layout">
<nav class="toc" aria-label="Contents"></nav>
<main>
${body}
</main>
</div>
<style>
.runs { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
.runs h3 { margin-top: 0; }
.events { list-style: none; padding: 0; margin: 0; }
.events li { padding: 0.35rem 0; border-top: 1px solid var(--line); }
.events .step { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 0.4rem; }
.events .quiet { font-size: 0.9em; }
.topic { font-weight: 600; }
.p { color: var(--muted); font-size: 0.85em; font-variant-numeric: tabular-nums; }
.suggested { color: var(--muted); font-weight: 400; }
.unsorted { color: var(--bad); }
.small { font-size: 0.85em; }
#articles-table td { vertical-align: top; }
#articles-table td:first-child { color: var(--muted); font-variant-numeric: tabular-nums; }
.legend { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.85em; color: var(--muted); }
.legend i { display: inline-block; width: 1.2em; height: 0.25em; vertical-align: middle; margin-right: 0.3em; }
</style>
${script}`
}

const esc = (s: string) =>
	s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")

const COLORS = ["var(--accent)", "var(--warn)", "var(--ok)", "var(--bad)"]
/** A run's color, then a dash pattern once the colors run out. */
const color = (i: number) => COLORS[i % COLORS.length]!
const dash = (i: number) =>
	i < COLORS.length ? "" : ` stroke-dasharray="${2 + 4 * Math.floor(i / COLORS.length)} 3"`

function topicName(run: RunResult, id: string): string {
	return run.topics.find((t) => t.id === id)?.name ?? id
}

/** A line of each run's share of sorted articles, with a mark where topics were created. */
function coverage(runs: ReportRun[]): string {
	const width = 720
	const height = 240
	const pad = { left: 44, right: 12, top: 12, bottom: 32 }
	if (runs.length === 0) return ""
	// At least two, so that a run of one article still has a width.
	const steps = Math.max(2, ...runs.map((r) => r.snapshots.length))
	const x = (step: number) => pad.left + ((step - 1) / (steps - 1)) * (width - pad.left - pad.right)
	const y = (share: number) => pad.top + (1 - share) * (height - pad.top - pad.bottom)
	const grid = [0, 0.25, 0.5, 0.75, 1]
		.map(
			(v) =>
				`<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pad.left - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v * 100}%</text>`,
		)
		.join("")
	const ticks = [1, 10, 20, 30, 40, 50, 60, steps]
		.filter((s, i, a) => s <= steps && a.indexOf(s) === i)
		.map(
			(s) =>
				`<text x="${x(s)}" y="${height - pad.bottom + 16}" text-anchor="middle" font-size="11" fill="var(--muted)">${s}</text>`,
		)
		.join("")
	const lines = runs
		.map((run, i) => {
			const points = run.snapshots
				.map((s) => `${x(s.step).toFixed(1)},${y(s.sorted / s.step).toFixed(1)}`)
				.join(" ")
			const marks = run.events
				.filter((e) => e.type === "bootstrap" || e.type === "new-topics")
				.map((e) => {
					const snap = run.snapshots[e.step - 1]!
					const names = e.topicIds.map((id) => topicName(run, id)).join(", ")
					return `<circle cx="${x(e.step)}" cy="${y(snap.sorted / snap.step)}" r="4" fill="${color(i)}"><title>${esc(run.name)}, article ${e.step}: ${esc(names)}</title></circle>`
				})
				.join("")
			return `<polyline points="${points}" fill="none" stroke="${color(i)}"${dash(i)} stroke-width="2"/>${marks}`
		})
		.join("")
	const legend = runs
		.map((r, i) => `<span><i style="background:${color(i)}"></i>${esc(label(r))}</span>`)
		.join("")
	return `<section id="coverage" data-toc="Coverage over time">
<h2>How much of the library is in a topic, article by article</h2>
<figure id="fig-coverage">
<div class="viz">
<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Share of articles in a topic after each arrival">${grid}${ticks}${lines}
<text x="${(width + pad.left) / 2}" y="${height - 2}" text-anchor="middle" font-size="11" fill="var(--muted)">articles saved</text></svg>
<p class="legend">${legend}<span>● topics created (hover for names)</span></p>
</div>
<figcaption>Before the first topics, nothing is sorted. The line drops when articles arrive that no topic holds, and climbs when a new topic takes them in.</figcaption>
</figure>
</section>`
}

function label(run: RunResult): string {
	const c = run.config
	return `${c.style === "specific" ? "Specific" : "Broad"} topics from ${c.bootstrapSize}${c.question === "shelf" ? ", shelf question" : ""}${c.widen ? ", widening" : ""}; ${c.classifier === "jev" ? "Jev" : "Haiku"} at ${c.applyThreshold} (${run.name})`
}

function sizes(run: RunResult) {
	const active = run.topics.filter((t) => t.retiredAt === undefined)
	const counts = active.map(
		(t) =>
			Object.values(run.assignments).filter((list) =>
				list.some((a) => a.topicId === t.id && a.level === "applied"),
			).length,
	)
	return { topics: active.length, largest: Math.max(0, ...counts) }
}

/** Every full run, one row each: how it was set up and where it ended. */
function ladder(all: ReportRun[], articleCount: number): string {
	const rows = all
		.filter((r) => r.articles.length === articleCount)
		.map((r) => {
			const c = r.config
			const { topics, largest } = sizes(r)
			const cost = r.calls.reduce((s, x) => s + x.cost, 0)
			return `<tr id="run-${esc(r.name)}"><td><code>${esc(r.name)}</code></td><td>${c.style === "specific" ? "specific" : "broad"}</td><td>${c.bootstrapSize}</td><td>${c.question === "shelf" ? "shelf" : "main subject"}</td><td>${c.widen ? "yes" : ""}</td><td>${c.classifier === "jev" ? "Jev" : "Haiku"} ${c.applyThreshold}</td><td>${r.unsorted.length}</td><td>${topics}</td><td>${largest}</td><td>$${cost.toFixed(3)}</td></tr>`
		})
		.join("")
	return `<section id="runs" data-toc="Every run">
<h2>Every run, from empty library to ${articleCount} articles</h2>
<p>"Largest" is the number of articles in the biggest topic. Runs ending in <code>-s1</code>, <code>-s2</code> repeat the run before them with Haiku asked afresh.</p>
<div class="table-wrap"><table id="runs-table">
<thead><tr><th>Run</th><th>Topics asked for</th><th>First topics at</th><th>Jev's question</th><th>Widening</th><th>Sorter</th><th>Unsorted</th><th>Topics</th><th>Largest</th><th>Cost</th></tr></thead>
<tbody>${rows}</tbody></table></div>
</section>`
}

/** The first topics of every try, grouped by how they were asked for. */
function stability(all: ReportRun[]): string {
	const groups = new Map<string, Map<string, string[]>>()
	for (const r of all) {
		const first = r.events.find((e) => e.type === "bootstrap")
		if (!first || first.type !== "bootstrap") continue
		const names = first.topicIds.map((id) => topicName(r, id))
		const key = `${r.config.style === "specific" ? "Specific" : "Broad"} topics, from the first ${r.config.bootstrapSize} articles`
		const tries = groups.get(key) ?? new Map<string, string[]>()
		// A run that reused a cached proposal is the same try.
		tries.set(names.join("|"), names)
		groups.set(key, tries)
	}
	const blocks = [...groups]
		.sort()
		.map(([key, tries]) => {
			const list = [...tries.values()]
			const words = (n: string) =>
				n
					.toLowerCase()
					.split(/[^a-z]+/)
					.filter((w) => w.length > 3)
			const recurring = (name: string) =>
				list.every((other) => other.some((o) => words(o).some((w) => words(name).includes(w))))
			return `<div><h3>${esc(key)}</h3><ol class="small">${list
				.map(
					(names) =>
						`<li>${names.map((n) => (recurring(n) ? `<strong>${esc(n)}</strong>` : esc(n))).join(", ")}</li>`,
				)
				.join("")}</ol></div>`
		})
		.join("")
	return `<section id="stability" data-toc="First topics, tried again">
<h2>The same first articles, asked again</h2>
<p>Each line is one try at the first topics from the same articles. In bold, topics that share a word with a topic of every other try in the group.</p>
<figure id="fig-stability"><div class="viz"><div class="runs">${blocks}</div></div>
<figcaption>Similar lines across tries mean the first topics depend less on chance.</figcaption></figure>
</section>`
}

/** What happened to the topics in each run, in order. */
function history(runs: ReportRun[], byId: Map<string, Article>): string {
	const column = (run: ReportRun) => {
		const items = run.events
			.filter((e) => e.type !== "arrive")
			.map((e) => `<li><span class="step">#${e.step}</span>${event(run, e, byId)}</li>`)
			.join("")
		return `<div id="history-${esc(run.name)}"><h3>${esc(label(run))}</h3><ul class="events">${items}</ul></div>`
	}
	return `<section id="history" data-toc="How the topics grew">
<h2>How the topics grew</h2>
<p>Each event with the number of the article that set it off. Open one to see why.</p>
<div class="runs">${runs.map(column).join("")}</div>
</section>`
}

function event(run: ReportRun, e: SimEvent, byId: Map<string, Article>): string {
	const topic = (id: string) => run.topics.find((t) => t.id === id)!
	const describe = (t: Topic) =>
		`<details><summary><span class="topic">${esc(t.name)}</span>${t.retiredAt ? ` <span class="p">(retired at #${t.retiredAt})</span>` : ""}</summary><p class="small">${esc(t.description)}</p><p class="small quiet">${esc(t.reason)}</p></details>`
	const titles = (ids: string[]) =>
		`<ul class="small quiet">${ids.map((id) => `<li>${esc(byId.get(id)?.title ?? id)}</li>`).join("")}</ul>`
	switch (e.type) {
		case "bootstrap":
			return `First topics, from the first ${e.step} articles:${e.topicIds.map((id) => describe(topic(id))).join("")}`
		case "new-topics":
			return `New topic from ${e.poolIds.length} unsorted articles:${e.topicIds.map((id) => describe(topic(id))).join("")}<details><summary class="quiet small">The unsorted articles</summary><p class="small quiet">${esc(e.note)}</p>${titles(e.poolIds)}</details>`
		case "no-new-topic":
			return `<details><summary>No new topic from ${e.poolIds.length} unsorted articles</summary><p class="small quiet">${esc(e.note)}</p>${titles(e.poolIds)}</details>`
		case "widen":
			return `<details><summary>Widened <span class="topic">${esc(topicName(run, e.topicId))}</span> for ${e.articleIds.length} unsorted articles</summary><p class="small"><del>${esc(e.from)}</del></p><p class="small">${esc(e.to)}</p><p class="small quiet">${esc(e.reason)}</p></details>`
		case "maintenance":
			return `<details><summary>Review: ${e.ops.length ? e.ops.map((o) => o.op).join(", ") : "no change"}</summary>${e.ops.length ? `<ul class="small">${e.ops.map((o) => `<li>${esc(describeOp(run, o))}</li>`).join("")}</ul>` : ""}<p class="small quiet">${esc(e.note)}</p></details>`
		default:
			return ""
	}
}

function describeOp(run: RunResult, op: MaintenanceOp): string {
	const names = (ids: string[]) => ids.map((id) => topicName(run, id)).join(" and ")
	switch (op.op) {
		case "merge":
			return `Merged ${names(op.topicIds)} into ${topicName(run, op.into)}: ${op.reason}`
		case "split":
			return `Split ${topicName(run, op.topicId)} into ${names(op.into)}: ${op.reason}`
		case "rename":
			return `Renamed ${op.from} to ${op.to}: ${op.reason}`
		case "retire":
			return `Retired ${names(op.topicIds)}: ${op.reason}`
	}
}

/**
 * The final topics, sorted again in the browser at the threshold the reader picks, from every
 * score the run kept.
 */
function thresholds(runs: ReportRun[], corpus: Article[]): string {
	const data = {
		titles: Object.fromEntries(corpus.map((a) => [a.id, a.title])),
		runs: runs.map((r) => ({
			name: label(r),
			max: r.config.maxTopicsPerArticle,
			topics: r.topics.filter((t) => t.retiredAt === undefined).map((t) => [t.id, t.name]),
			scores: r.scores,
		})),
	}
	// No "<" at all inside the script: neither "</script>" nor "<!--" can end or confuse it.
	const json = JSON.stringify(data).replaceAll("<", "\\u003c")
	return `<section id="threshold" data-toc="Final topics">
<h2>The final topics, at the threshold you choose</h2>
<p>Every article is sorted again into the run's final topics, applying a topic when its probability reaches the threshold (at most ${runs[0]?.config.maxTopicsPerArticle ?? 3} per article). Move it to see how many articles each topic would hold and how many would stay unsorted.</p>
<figure id="fig-threshold">
<div class="viz">
<label>Apply a topic at <output id="threshold-value">0.70</output>
<input id="threshold-input" type="range" min="0.3" max="0.95" step="0.05" value="0.7" style="width:100%"></label>
<div class="runs" id="threshold-runs"></div>
</div>
<figcaption>Each run's classifier gave these probabilities; two classifiers' numbers need not mean the same.</figcaption>
</figure>
<script>
(() => {
	const data = ${json}
	const input = document.getElementById("threshold-input")
	const out = document.getElementById("threshold-value")
	const root = document.getElementById("threshold-runs")
	const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
	function render() {
		const t = Number(input.value)
		out.textContent = t.toFixed(2)
		root.innerHTML = data.runs.map((run) => {
			const names = Object.fromEntries(run.topics)
			const members = Object.fromEntries(run.topics.map(([id]) => [id, []]))
			const unsorted = []
			for (const [articleId, scores] of Object.entries(run.scores)) {
				const picked = Object.entries(scores)
					.filter(([id, p]) => names[id] && p >= t)
					.sort((a, b) => b[1] - a[1])
					.slice(0, run.max)
				if (!picked.length) unsorted.push(articleId)
				for (const [id, p] of picked) members[id].push([articleId, p])
			}
			const total = Object.keys(run.scores).length
			const top = Math.max(1, ...Object.values(members).map((m) => m.length))
			const rows = run.topics
				.map(([id, name]) => [id, name, members[id]])
				.sort((a, b) => b[2].length - a[2].length)
				.map(([id, name, list]) => '<details><summary><span class="topic">' + esc(name) + '</span> <span class="p">' + list.length + '</span><span style="display:block;height:4px;background:var(--accent);width:' + (100 * list.length / top) + '%"></span></summary><ul class="small">' + list.sort((a, b) => b[1] - a[1]).map(([a, p]) => '<li>' + esc(data.titles[a]) + ' <span class="p">' + p.toFixed(2) + '</span></li>').join("") + '</ul></details>')
				.join("")
			return '<div><h3>' + esc(run.name) + '</h3><p class="small">' + (total - unsorted.length) + ' of ' + total + ' in a topic, <span class="unsorted">' + unsorted.length + ' unsorted</span></p>' + rows + '<details><summary class="unsorted">Unsorted</summary><ul class="small">' + unsorted.map((a) => '<li>' + esc(data.titles[a]) + '</li>').join("") + '</ul></details></div>'
		}).join("")
	}
	input.addEventListener("input", render)
	render()
})()
</script>
</section>`
}

/** Every article with the hand-made tags and what each run gave it. */
function articles(runs: ReportRun[], corpus: Article[]): string {
	const cell = (run: ReportRun, id: string) => {
		const list: Assignment[] = run.assignments[id] ?? []
		if (!list.some((a) => a.level === "applied") && run.unsorted.includes(id)) {
			const hints = list.map(
				(a) =>
					`<span class="suggested">${esc(topicName(run, a.topicId))} <span class="p">${a.p.toFixed(2)}</span></span>`,
			)
			return `<span class="unsorted">unsorted</span>${hints.length ? `<br>${hints.join("<br>")}` : ""}`
		}
		return list
			.map(
				(a) =>
					`<span class="${a.level === "applied" ? "topic" : "suggested"}">${esc(topicName(run, a.topicId))}</span> <span class="p">${a.p.toFixed(2)}</span>`,
			)
			.join("<br>")
	}
	const rows = corpus
		.map(
			(a, i) =>
				`<tr id="article-${a.id.slice(0, 8)}"><td>${i + 1}</td><td>${esc(a.title)}<br><span class="p">${esc(a.siteName ?? "")}</span></td><td class="small">${esc(a.manualTags.join(", "))}</td>${runs.map((r) => `<td class="small">${cell(r, a.id)}</td>`).join("")}</tr>`,
		)
		.join("")
	return `<section id="articles" data-toc="Every article">
<h2>Every article, in the order it was saved</h2>
<p>Applied topics in bold, suggestions in grey, with the probability at the end of the run. "Your tags" are the demo account's hand-made tags, which the models never saw.</p>
<div class="table-wrap"><table id="articles-table">
<thead><tr><th>#</th><th>Article</th><th>Your tags</th>${runs.map((r) => `<th>${esc(label(r))}</th>`).join("")}</tr></thead>
<tbody>${rows}</tbody></table></div>
</section>`
}

/** What each run cost and how long its calls took, and what that means per thousand articles. */
function costs(runs: ReportRun[], articleCount: number): string {
	const rows = runs
		.flatMap((run) => {
			const groups = new Map<string, CallRecord[]>()
			for (const c of run.calls) {
				const key = `${c.provider === "jev" ? "Jev" : "Haiku"}: ${c.purpose}`
				groups.set(key, [...(groups.get(key) ?? []), c])
			}
			const total = run.calls.reduce((s, c) => s + c.cost, 0)
			return [
				...[...groups].map(([key, calls]) => {
					const ms = calls.map((c) => c.ms).sort((a, b) => a - b)
					const cost = calls.reduce((s, c) => s + c.cost, 0)
					const tokens = calls.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0)
					return `<tr><td>${esc(run.name)}</td><td>${esc(key)}</td><td>${calls.length}</td><td>${tokens.toLocaleString("en")}</td><td>${ms[Math.floor(ms.length / 2)]} ms</td><td>$${cost.toFixed(4)}</td></tr>`
				}),
				`<tr><td>${esc(run.name)}</td><td><strong>Total</strong></td><td>${run.calls.length}</td><td></td><td></td><td><strong>$${total.toFixed(4)}</strong> · $${((total / Math.max(1, articleCount)) * 1000).toFixed(2)} per 1,000 articles</td></tr>`,
			]
		})
		.join("")
	return `<section id="costs" data-toc="Cost and speed">
<h2>Cost and speed of each run</h2>
<p>"sort" puts one article into topics, "propose" names the first topics, "grow" asks the unsorted articles for a new topic, "maintain" reviews the topics. Times are the median of each kind of call when it was first made.</p>
<div class="table-wrap"><table>
<thead><tr><th>Run</th><th>Calls</th><th>Count</th><th>Tokens</th><th>Median time</th><th>Cost</th></tr></thead>
<tbody>${rows}</tbody></table></div>
</section>`
}

/** How often the two classifiers agree when they sort into the same topics. */
function compare(c: Comparison, corpus: Article[]): string {
	const names = new Map(c.topics.map((t) => [t.id, t.name]))
	const picked = (scores: Record<string, number> | undefined, t: number) =>
		Object.entries(scores ?? {})
			.filter(([id, p]) => names.has(id) && p >= t)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
	const stats = (t: number) => {
		let same = 0
		let overlap = 0
		let jevNone = 0
		let haikuNone = 0
		let topSame = 0
		for (const a of corpus) {
			const j = picked(c.scores.jev[a.id], t).map(([id]) => id)
			const h = picked(c.scores.haiku[a.id], t).map(([id]) => id)
			if (j.length === h.length && j.every((id) => h.includes(id))) same++
			if (j.some((id) => h.includes(id))) overlap++
			if (!j.length) jevNone++
			if (!h.length) haikuNone++
			const best = (s: Record<string, number> | undefined) =>
				Object.entries(s ?? {}).sort((x, y) => y[1] - x[1])[0]?.[0]
			if (best(c.scores.jev[a.id]) === best(c.scores.haiku[a.id])) topSame++
		}
		return { same, overlap, jevNone, haikuNone, topSame }
	}
	const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, corpus.length))}%`
	const rows = [0.5, 0.7]
		.map((t) => {
			const s = stats(t)
			return `<tr><td>${t}</td><td>${pct(s.same)}</td><td>${pct(s.overlap)}</td><td>${s.jevNone}</td><td>${s.haikuNone}</td></tr>`
		})
		.join("")
	const top = stats(0)
	const list = (scores: Record<string, number> | undefined) =>
		picked(scores, 0.4)
			.map(
				([id, p]) =>
					`<span class="${p >= 0.7 ? "topic" : "suggested"}">${esc(names.get(id)!)}</span> <span class="p">${p.toFixed(2)}</span>`,
			)
			.join("<br>") || '<span class="unsorted">none</span>'
	const differ = corpus.filter((a) => {
		const j = picked(c.scores.jev[a.id], 0.7).map(([id]) => id)
		const h = picked(c.scores.haiku[a.id], 0.7).map(([id]) => id)
		return !(j.length === h.length && j.every((id) => h.includes(id)))
	})
	const differRows = differ
		.map(
			(a) =>
				`<tr><td>${esc(a.title)}<br><span class="p">${esc(a.siteName ?? "")}</span></td><td class="small">${list(c.scores.jev[a.id])}</td><td class="small">${list(c.scores.haiku[a.id])}</td></tr>`,
		)
		.join("")
	return `<section id="same-topics" data-toc="Same topics, two sorters">
<h2>Same topics, two sorters: Jev and Haiku agree on the main topic of ${pct(top.topSame)} of articles</h2>
<p>Both classifiers sorted all ${corpus.length} articles into the ${c.topics.length} final topics of the <strong>${esc(c.run)}</strong> run: ${c.topics.map((t) => esc(t.name)).join(", ")}. This separates the sorter from the topics it was given.</p>
<div class="table-wrap"><table id="same-topics-table">
<thead><tr><th>Apply at</th><th>Exactly the same topics</th><th>At least one in common</th><th>Jev: no topic</th><th>Haiku: no topic</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<details id="same-topics-differ"><summary>The ${differ.length} articles where they differ at 0.7</summary>
<p class="small quiet">Topics at 0.7 or more in bold, from 0.4 in grey.</p>
<div class="table-wrap"><table><thead><tr><th>Article</th><th>Jev</th><th>Haiku</th></tr></thead><tbody>${differRows}</tbody></table></div>
</details>
</section>`
}
