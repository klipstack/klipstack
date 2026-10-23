import type { KlipstackClient } from "@klipstack/sdk"
import { SymbolView } from "expo-symbols"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import {
	ActivityIndicator,
	Alert,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native"
import { type Tagged, tagChange, tagChoices, tagState, withChange } from "@/lib/article-tags"
import { errorMessage, t } from "@/lib/i18n"
import { type Colors, useColors } from "@/lib/theme"

/**
 * The tag sheet for a screen's articles: `open` shows it for one article (its long-press menu, the
 * reader) or several (multi-select), and `sheet` goes in the screen. `onTags` gets the articles'
 * tags as they change: at once, then as the server has them.
 */
export function useTagSheet(
	client: KlipstackClient | null,
	onTags: (tags: Map<string, string[]>) => void,
): { open: (articles: Tagged[]) => void; sheet: ReactNode } {
	const colors = useColors()
	const [articles, setArticles] = useState<Tagged[] | null>(null)
	const open = useCallback(
		(chosen: Tagged[]) => setArticles(chosen.map((a) => ({ id: a.id, tags: a.tags }))),
		[],
	)
	const sheet = articles ? (
		<TagSheet
			client={client}
			articles={articles}
			onTags={(tags) => {
				setArticles(
					(shown) => shown && shown.map((a) => ({ ...a, tags: tags.get(a.id) ?? a.tags })),
				)
				onTags(tags)
			}}
			onClose={() => setArticles(null)}
			colors={colors}
		/>
	) : null
	return { open, sheet }
}

/**
 * Every tag, with a check on those the articles have (a dash on those only some of them have), and
 * a field that finds a tag or makes a new one: the web's tag dialog, on a phone. A tap adds the tag
 * when an article lacks it and takes it away when all have it (`tagChange`), through
 * `PATCH /articles`, at once; there is nothing to confirm.
 */
function TagSheet({
	client,
	articles,
	onTags,
	onClose,
	colors,
}: {
	client: KlipstackClient | null
	articles: Tagged[]
	onTags: (tags: Map<string, string[]>) => void
	onClose: () => void
	colors: Colors
}) {
	const [names, setNames] = useState<string[] | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [typed, setTyped] = useState("")
	// Uncontrolled: fast typing isn't undone by a render that lags behind it.
	const field = useRef<TextInput>(null)

	useEffect(() => {
		if (!client) return
		let live = true
		client.tags
			.list()
			.then((answer) => {
				if (live) setNames(answer.items.map((t) => t.name))
			})
			.catch((e: unknown) => {
				if (live) setError(errorMessage(e))
			})
		return () => {
			live = false
		}
	}, [client])

	async function toggle(name: string) {
		if (!client) return
		const change = tagChange(articles, name)
		const before = new Map(articles.map((a) => [a.id, a.tags]))
		onTags(withChange(articles, change))
		// A new name is a tag from now on: the server makes it.
		setNames((shown) =>
			shown && !shown.some((n) => n.toLowerCase() === name.toLowerCase())
				? [...shown, name]
				: shown,
		)
		field.current?.clear()
		setTyped("")
		try {
			const answer = await client.articles.update(
				articles.map((a) => a.id),
				change,
			)
			onTags(new Map(answer.items.map((a) => [a.id, a.tags])))
		} catch (e) {
			onTags(before)
			Alert.alert(t("common.failed.notSaved"), errorMessage(e))
		}
	}

	const choices = names ? tagChoices(names, typed) : null
	const create = choices?.create ?? null
	const many = articles.length > 1
	return (
		<Modal visible presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
			<View style={[styles.sheet, { backgroundColor: colors.bg }]}>
				<View style={[styles.bar, { borderColor: colors.border }]}>
					<Text style={[styles.title, { color: colors.fg }]}>
						{many
							? t("library.tagSheet.titleMany", { number: articles.length })
							: t("library.tagSheet.title")}
					</Text>
					<Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.done}>
						<Text style={[styles.doneText, { color: colors.accent }]}>
							{t("common.actions.done")}
						</Text>
					</Pressable>
				</View>
				<TextInput
					ref={field}
					onChangeText={setTyped}
					placeholder={t("library.tagSheet.placeholder")}
					placeholderTextColor={colors.mutedFg}
					autoCapitalize="none"
					autoCorrect={false}
					returnKeyType="done"
					// Return makes the new tag, or picks the one tag that matches.
					onSubmitEditing={() => {
						const pick = create ?? (choices?.names.length === 1 ? choices.names[0] : null)
						if (pick) void toggle(pick)
					}}
					style={[
						styles.field,
						{ color: colors.fg, backgroundColor: colors.muted, borderColor: colors.border },
					]}
				/>
				<ScrollView
					contentContainerStyle={styles.list}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="on-drag"
					automaticallyAdjustKeyboardInsets
				>
					{!choices ? (
						error ? (
							<Text style={[styles.message, { color: colors.mutedFg }]}>{error}</Text>
						) : (
							<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
						)
					) : (
						<>
							{create ? (
								<TagRow
									label={t("library.tagSheet.create", { name: create })}
									icon="plus"
									onPress={() => void toggle(create)}
									colors={colors}
								/>
							) : null}
							{choices.names.map((name) => {
								const state = tagState(articles, name)
								return (
									<TagRow
										key={name}
										label={name}
										icon={state === "all" ? "checkmark" : state === "some" ? "minus" : null}
										checked={state}
										onPress={() => void toggle(name)}
										colors={colors}
									/>
								)
							})}
							{names?.length === 0 && !create ? (
								<Text style={[styles.message, { color: colors.mutedFg }]}>
									{t("library.tagSheet.empty")}
								</Text>
							) : null}
						</>
					)}
				</ScrollView>
			</View>
		</Modal>
	)
}

function TagRow({
	label,
	icon,
	checked,
	onPress,
	colors,
}: {
	label: string
	icon: "checkmark" | "minus" | "plus" | null
	checked?: "all" | "some" | "none"
	onPress: () => void
	colors: Colors
}) {
	return (
		<Pressable
			accessibilityRole={checked ? "checkbox" : "button"}
			accessibilityLabel={label}
			accessibilityState={
				checked ? { checked: checked === "all" ? true : checked === "some" ? "mixed" : false } : {}
			}
			onPress={onPress}
			style={({ pressed }) => [
				styles.row,
				{ borderColor: colors.border },
				pressed && { backgroundColor: colors.muted },
			]}
		>
			{icon === "plus" ? (
				<SymbolView name="plus.circle" tintColor={colors.accent} size={22} />
			) : (
				<SymbolView name="tag" tintColor={colors.mutedFg} size={20} />
			)}
			<Text
				style={[styles.label, { color: icon === "plus" ? colors.accent : colors.fg }]}
				numberOfLines={1}
			>
				{label}
			</Text>
			{icon === "checkmark" || icon === "minus" ? (
				<SymbolView name={icon} tintColor={colors.accent} size={18} weight="semibold" />
			) : null}
		</Pressable>
	)
}

const styles = StyleSheet.create({
	sheet: { flex: 1 },
	bar: {
		height: 56,
		alignItems: "center",
		justifyContent: "center",
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	title: { fontSize: 17, fontWeight: "600" },
	done: { position: "absolute", right: 16 },
	doneText: { fontSize: 17, fontWeight: "600" },
	field: {
		margin: 16,
		marginBottom: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 17,
		borderRadius: 10,
		borderWidth: StyleSheet.hairlineWidth,
	},
	list: { paddingHorizontal: 16, paddingBottom: 48 },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		minHeight: 48,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	label: { flex: 1, fontSize: 17 },
	message: { padding: 16, textAlign: "center", fontSize: 15, lineHeight: 21 },
	loading: { paddingVertical: 32 },
})
