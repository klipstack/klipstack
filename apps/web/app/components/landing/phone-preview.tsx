import { useTranslation } from "react-i18next"

/**
 * The iPhone app on the landing page: its reader reading aloud, in a phone's outline. Two
 * screenshots of one moment and the next; the second fades in and out over the first, so the
 * spoken sentence's highlight moves on (still, with reduced motion).
 */
export function PhonePreview() {
	const { t } = useTranslation()
	const shot = "aspect-[1206/2622] w-full rounded-[2.4rem] object-cover"
	return (
		<figure className="flex flex-col items-center gap-4">
			<div className="relative w-[15.5rem] shrink-0 rounded-[2.9rem] border border-border bg-fg/90 p-2.5 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.45)] sm:w-[17rem]">
				<div className="relative">
					<img
						src="/landing/iphone-reader-1.webp"
						alt={t("home.phone.shotAlt")}
						width={600}
						height={1305}
						loading="lazy"
						className={shot}
					/>
					<img
						src="/landing/iphone-reader-2.webp"
						alt=""
						width={600}
						height={1305}
						loading="lazy"
						className={`speak-next absolute inset-0 ${shot}`}
					/>
				</div>
			</div>
			<figcaption className="text-sm text-muted-fg">{t("home.phone.caption")}</figcaption>
		</figure>
	)
}
