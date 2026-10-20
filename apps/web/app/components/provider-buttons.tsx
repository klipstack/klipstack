import { useTranslation } from "react-i18next"
import { Button } from "./ui/button"

export type ProviderId = "apple" | "google" | "github"

export const PROVIDER_NAMES: Record<ProviderId, string> = {
	apple: "Apple",
	google: "Google",
	github: "GitHub",
}

const MARKS: Record<ProviderId, string> = {
	// Simple Icons (CC0), as Apple's guidelines draw it.
	apple:
		"M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
	google:
		"M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.18-1.73 4.1-1.02 1.08-2.62 2.24-5.43 2.24-4.34 0-7.78-3.5-7.78-7.84s3.44-7.84 7.78-7.84c2.35 0 4.06.92 5.32 2.12l2.3-2.3C18.7 2.66 16.06 1.4 12.48 1.4 6.62 1.4 1.7 6.18 1.7 12.04s4.92 10.64 10.78 10.64c3.16 0 5.54-1.04 7.4-2.98 1.92-1.92 2.52-4.6 2.52-6.78 0-.68-.06-1.3-.16-1.82l-9.76-.18Z",
	github:
		"M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.78c-2.92.64-3.54-1.4-3.54-1.4-.48-1.22-1.17-1.54-1.17-1.54-.95-.65.08-.64.08-.64 1.05.08 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.67-1.4-2.33-.27-4.78-1.17-4.78-5.19 0-1.15.41-2.08 1.08-2.82-.1-.26-.47-1.33.1-2.78 0 0 .89-.28 2.89 1.08a10 10 0 0 1 5.26 0c2-1.36 2.88-1.08 2.88-1.08.58 1.45.22 2.52.11 2.78.67.74 1.08 1.67 1.08 2.82 0 4.03-2.46 4.92-4.8 5.18.38.33.72.97.72 1.95v2.89c0 .28.19.6.72.5A10.5 10.5 0 0 0 12 1.5Z",
}

export function ProviderMark({ provider }: { provider: ProviderId }) {
	return (
		<svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="currentColor" aria-hidden="true">
			<path d={MARKS[provider]} />
		</svg>
	)
}

/**
 * Submit buttons for the enclosing form: they post `provider` with the form's other fields (the
 * invite code on /signup) and skip the validation of the fields they do not need.
 */
export function ProviderButtons({
	providers,
	disabled,
}: {
	providers: readonly ProviderId[]
	disabled?: boolean
}) {
	const { t } = useTranslation("auth")
	if (providers.length === 0) return null
	return (
		<>
			<p className="flex items-center gap-3 text-xs text-muted-fg before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
				{t("providers.or")}
			</p>
			{providers.map((provider) => (
				<Button
					key={provider}
					type="submit"
					variant="secondary"
					name="provider"
					value={provider}
					formNoValidate
					disabled={disabled}
				>
					<ProviderMark provider={provider} />
					{t("providers.continueWith", { provider: PROVIDER_NAMES[provider] })}
				</Button>
			))}
		</>
	)
}
