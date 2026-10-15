import {
	ArrowLeft,
	BookmarkPlus,
	CircleUserRound,
	Download,
	Gauge,
	Info,
	KeyRound,
	Keyboard,
	Menu,
	Palette,
	Plug,
	X,
} from "lucide-react"
import { useId } from "react"
import { useTranslation } from "react-i18next"
import { Link, NavLink } from "react-router"
import { useKeyTranslation } from "~/lib/i18n-keys"
import { usePageBar } from "~/lib/page-bar"
import { useSettingsOrigin } from "~/lib/settings-origin"
import { useSidebar } from "~/lib/sidebar"
import { linkClass, NavItemInk } from "./app-shell"
import { MobileDrawer, useMobileDrawer } from "./mobile-drawer"

/** One route per section, under `/settings/`; their pages are `routes/settings.<slug>.tsx`. */
const GROUPS = [
	{
		key: "general",
		sections: [
			{ slug: "account", key: "account.title", icon: CircleUserRound },
			{ slug: "appearance", key: "appearance.title", icon: Palette },
			{ slug: "shortcuts", key: "shortcuts.title", icon: Keyboard },
		],
	},
	{
		key: "connections",
		sections: [
			{ slug: "capture", key: "capture.title", icon: BookmarkPlus },
			{ slug: "api-keys", key: "apiKeys.title", icon: KeyRound },
			{ slug: "connected-apps", key: "connectedApps.title", icon: Plug },
		],
	},
	{
		key: "data",
		sections: [
			{ slug: "usage", key: "usage.title", icon: Gauge },
			{ slug: "data", key: "data.title", icon: Download },
		],
	},
] as const

function SectionLink({
	slug,
	label,
	icon,
	onNavigate,
}: {
	slug: string
	label: string
	icon: typeof Info
	onNavigate?: () => void
}) {
	return (
		<NavLink
			to={`/settings/${slug}`}
			prefetch="intent"
			onClick={onNavigate}
			className={linkClass(false)}
		>
			<NavItemInk icon={icon}>{label}</NavItemInk>
		</NavLink>
	)
}

/** The way back, then the sections: shared by the desktop sidebar and the phone drawer. */
function SettingsNav({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
	const { t } = useTranslation("settings")
	const { t: tc } = useTranslation()
	const origin = useSettingsOrigin()
	const headingId = useId()
	return (
		<>
			{/* 40px tall, as the main sidebar's brand row: each page's title lines up with it. */}
			<div className="mb-6 flex min-h-10 items-center justify-between gap-1">
				<Link
					to={origin}
					onClick={onNavigate}
					data-testid="settings-back"
					className="flex min-w-0 flex-1 items-center rounded-lg px-2 py-2 text-sm font-medium hover:[&_[data-nav-ink]]:ink-hover-item md:py-1.5"
				>
					<NavItemInk icon={ArrowLeft}>{tc("actions.back")}</NavItemInk>
				</Link>
				{onClose ? (
					<button
						type="button"
						onClick={onClose}
						aria-label={tc("actions.close")}
						className="rounded-md p-2 text-muted-fg hover:bg-muted"
					>
						<X className="size-5" aria-hidden />
					</button>
				) : null}
			</div>
			<nav aria-labelledby={headingId} className="flex flex-1 flex-col gap-4">
				<h2 id={headingId} className="px-2 text-lg font-semibold">
					{t("title")}
				</h2>
				{GROUPS.map((group) => (
					<section key={group.key} aria-label={t(`nav.${group.key}`)}>
						<h3 className="px-2 pb-1 text-xs font-medium text-muted-fg">{t(`nav.${group.key}`)}</h3>
						<ul className="flex flex-col gap-1">
							{group.sections.map((section) => (
								<li key={section.slug}>
									<SectionLink
										slug={section.slug}
										label={t(section.key)}
										icon={section.icon}
										onNavigate={onNavigate}
									/>
								</li>
							))}
						</ul>
					</section>
				))}
				<div className="mt-auto border-t border-border pt-3">
					<SectionLink slug="about" label={t("about.title")} icon={Info} onNavigate={onNavigate} />
				</div>
			</nav>
		</>
	)
}

/**
 * Settings' own frame, in place of the app's: a sidebar of its sections, with the way back to the
 * page Settings was opened from. Phones get the same list in a drawer, and a bar with the section's
 * title.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const tk = useKeyTranslation()
	const sidebar = useSidebar()
	const drawer = useMobileDrawer()
	const { open, setOpen, menuButtonRef } = drawer
	const bar = usePageBar()
	return (
		<div className="flex min-h-dvh">
			<aside
				// As wide as the app's sidebar when it is open, so the switch does not jump.
				style={{ width: sidebar.width }}
				className="hidden shrink-0 flex-col border-r border-border bg-muted/40 p-4 md:sticky md:top-0 md:flex md:h-dvh md:overflow-y-auto"
			>
				<SettingsNav />
			</aside>
			<div inert={open} className="flex min-w-0 flex-1 flex-col">
				<header className="safe-top sticky top-0 z-20 flex min-h-13 items-center gap-1 border-b border-border bg-bg/90 px-2 py-1.5 backdrop-blur md:hidden">
					<button
						ref={menuButtonRef}
						type="button"
						onClick={() => setOpen(true)}
						aria-label={t("nav.menu")}
						aria-expanded={open}
						aria-controls="mobile-drawer"
						className="rounded-md p-2.5 text-muted-fg hover:bg-muted hover:text-fg"
					>
						<Menu className="size-5" aria-hidden />
					</button>
					<h1 className="min-w-0 flex-1 truncate font-display text-lg font-medium">
						{bar ? tk(bar.titleKey) : t("nav.settings")}
					</h1>
				</header>
				{children}
			</div>
			<MobileDrawer drawer={drawer}>
				<SettingsNav onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
			</MobileDrawer>
		</div>
	)
}
