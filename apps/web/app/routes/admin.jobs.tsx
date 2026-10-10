import { useTranslation } from "react-i18next"
import { Link, useFetcher, useOutletContext } from "react-router"
import {
	ActionError,
	Badge,
	ConfirmSubmit,
	Empty,
	Mono,
	PageHeader,
	Pager,
	RefreshButton,
	Table,
	useUtcTime,
} from "~/components/admin/ui"
import { requireAdmin } from "~/lib/admin.server"
import {
	type FailedDocument,
	type FailedJob,
	listFailedDocuments,
	listFailedJobs,
} from "~/services/admin-jobs.server"
import type { Route } from "./+types/admin.jobs"
import type { AdminOutletContext } from "./admin-layout"
import type { action as retryAction } from "./admin.jobs.retry"

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	const url = new URL(request.url)
	const [documents, jobs] = await Promise.all([
		listFailedDocuments(ctx, { cursor: url.searchParams.get("cursor") }),
		listFailedJobs(ctx, { cursor: url.searchParams.get("jobsCursor") }),
	])
	return {
		documents,
		jobs,
		cursor: url.searchParams.get("cursor"),
		jobsCursor: url.searchParams.get("jobsCursor"),
	}
}

function Owner({ id }: { id: string | null }) {
	if (!id) return null
	return (
		<Link to={`/admin/users/${id}`} prefetch="none" className="text-link">
			<Mono>{id}</Mono>
		</Link>
	)
}

function Retry({ fields }: { fields: Record<string, string> }) {
	const { t } = useTranslation("admin")
	const fetcher = useFetcher<typeof retryAction>()
	if (fetcher.data?.ok)
		return (
			<p className="text-xs text-muted-fg" role="status">
				{t("jobs.admitted")}
			</p>
		)
	return (
		<fetcher.Form method="post" action="/admin/jobs/retry">
			{Object.entries(fields).map(([name, value]) => (
				<input key={name} type="hidden" name={name} value={value} />
			))}
			<ConfirmSubmit
				label={t("jobs.retry")}
				question={t("jobs.retryConfirm")}
				busy={fetcher.state !== "idle"}
			/>
			{fetcher.data && !fetcher.data.ok ? <ActionError code={fetcher.data.error.code} /> : null}
		</fetcher.Form>
	)
}

function DocumentRow({ doc, canWrite }: { doc: FailedDocument; canWrite: boolean }) {
	const time = useUtcTime()
	return (
		<tr data-testid={`failed-document-${doc.documentId}`}>
			<td>
				<Mono>{doc.documentId}</Mono>
			</td>
			<td>
				<Owner id={doc.ownerId} />
			</td>
			<td>
				<Badge tone="bad">{doc.category}</Badge>
			</td>
			<td>{time(doc.failedAt)}</td>
			<td>
				{canWrite ? <Retry fields={{ kind: "extract", documentId: doc.documentId }} /> : null}
			</td>
		</tr>
	)
}

function JobRow({ job, canWrite }: { job: FailedJob; canWrite: boolean }) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	const follow = job.followUp
	const followKey = follow?.state === "completed" ? follow.outcome : follow?.state
	return (
		<tr data-testid={`failed-job-${job.jobId}`}>
			<td>{job.queue}</td>
			<td>
				<Mono>{job.jobId}</Mono>
				{job.documentId ? (
					<div className="text-muted-fg">
						{t("jobs.document")}: <Mono>{job.documentId}</Mono>
					</div>
				) : null}
			</td>
			<td>
				<Owner id={job.ownerId} />
			</td>
			<td>
				<Badge tone="bad">{job.category}</Badge>
			</td>
			<td className="tabular-nums">{job.attempts}</td>
			<td>{time(job.failedAt ?? job.createdAt)}</td>
			<td>
				{followKey ? (
					<Badge tone={followKey === "completed" ? "good" : "neutral"}>
						{t(`jobs.followUp.${followKey}`)}
					</Badge>
				) : null}
			</td>
			<td>
				{job.queue !== "images" ? (
					<span className="text-xs text-muted-fg">{t("jobs.noRetry")}</span>
				) : !job.retryable ? (
					<span className="text-xs text-muted-fg">{t("jobs.notRetryable")}</span>
				) : canWrite ? (
					<Retry fields={{ kind: "images", jobId: job.jobId }} />
				) : null}
			</td>
		</tr>
	)
}

export default function AdminJobs({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const { canWrite } = useOutletContext<AdminOutletContext>()
	const { documents, jobs } = loaderData
	return (
		<>
			<PageHeader title={t("jobs.title")}>
				<RefreshButton />
			</PageHeader>

			<h2 className="mb-1 text-lg font-semibold">{t("jobs.failedDocuments")}</h2>
			<p className="mb-3 text-sm text-muted-fg">{t("jobs.failedDocumentsHint")}</p>
			{documents.documents.length ? (
				<Table
					caption={t("jobs.failedDocuments")}
					head={[t("jobs.document"), t("jobs.owner"), t("jobs.category"), t("jobs.failedAt"), ""]}
				>
					{documents.documents.map((doc) => (
						<DocumentRow key={doc.documentId} doc={doc} canWrite={canWrite} />
					))}
				</Table>
			) : (
				<Empty>{t("jobs.emptyDocuments")}</Empty>
			)}
			<Pager
				path="/admin/jobs"
				nextCursor={documents.nextCursor}
				params={{ jobsCursor: loaderData.jobsCursor }}
			/>

			<h2 className="mt-10 mb-1 text-lg font-semibold">{t("jobs.failedJobs")}</h2>
			<p className="mb-3 text-sm text-muted-fg">{t("jobs.failedJobsHint")}</p>
			{jobs.jobs.length ? (
				<Table
					caption={t("jobs.failedJobs")}
					head={[
						t("jobs.type"),
						t("jobs.job"),
						t("jobs.owner"),
						t("jobs.category"),
						t("jobs.attempts"),
						t("jobs.failedAt"),
						t("jobs.followUp.label"),
						"",
					]}
				>
					{jobs.jobs.map((job) => (
						<JobRow key={job.jobId} job={job} canWrite={canWrite} />
					))}
				</Table>
			) : (
				<Empty>{t("jobs.emptyJobs")}</Empty>
			)}
			{jobs.nextCursor ? (
				<nav className="mt-4 text-sm">
					<Link
						prefetch="none"
						className="text-link hover:underline"
						to={`/admin/jobs?${new URLSearchParams({
							...(loaderData.cursor ? { cursor: loaderData.cursor } : {}),
							jobsCursor: jobs.nextCursor,
						})}`}
					>
						{t("common.next")}
					</Link>
				</nav>
			) : null}
		</>
	)
}
