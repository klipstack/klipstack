import { Trans, useTranslation } from "react-i18next"

/**
 * A quiet line on an empty screen, for a new account that has never saved with the browser
 * extension: where to get it (`url`, the extension page).
 */
export function ExtensionHint({ url }: { url: string }) {
	const { t } = useTranslation()
	return (
		<p className="max-w-sm text-xs text-muted-fg" data-testid="extension-hint">
			<Trans
				t={t}
				i18nKey="extensionHint"
				components={{
					store: (
						// oxlint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- Trans fills it
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2 hover:text-fg"
						/>
					),
				}}
			/>
		</p>
	)
}
