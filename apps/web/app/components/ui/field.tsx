import { useId } from "react"
import { useIsNsKey, useKeyTranslation } from "~/lib/i18n-keys"
import { Input } from "./input"
import { Label } from "./label"

interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> {
	label: string
	name: string
	/** i18n key or plain message */
	error?: string
	hint?: string
}

export function Field({ label, name, error, hint, ...inputProps }: FieldProps) {
	const id = useId()
	const tk = useKeyTranslation()
	const isNsKey = useIsNsKey()
	const errorText = error ? (isNsKey(error) ? tk(error) : error) : null
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				name={name}
				aria-invalid={Boolean(errorText) || undefined}
				aria-describedby={errorText ? `${id}-error` : hint ? `${id}-hint` : undefined}
				{...inputProps}
			/>
			{errorText ? (
				<p id={`${id}-error`} className="text-sm text-danger">
					{errorText}
				</p>
			) : hint ? (
				<p id={`${id}-hint`} className="text-sm text-muted-fg">
					{hint}
				</p>
			) : null}
		</div>
	)
}
