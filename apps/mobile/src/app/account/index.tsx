import type { Me, Usage } from "@klipstack/sdk"
import { router } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native"
import { Choices, listStyles, Row, Section } from "@/components/grouped-list"
import { AI_CONSENT } from "@/lib/ai"
import { useAuth } from "@/lib/auth"
import { COLOR_SCHEMES, type ColorSchemePref } from "@/lib/color-scheme"
import { APP_VERSION } from "@/lib/config"
import { t } from "@/lib/i18n"
import { exportLibrary } from "@/lib/library-export"
import { loadColorScheme, loadTypePrefs, saveColorScheme, saveTypePrefs } from "@/lib/reader-files"
import { applyColorScheme, type Colors, fonts, useColors } from "@/lib/theme"
import { resetsOn, type UsageRow, usageRows } from "@/lib/usage"
import { openOnTheWeb } from "@/lib/web-pages"
import { speech } from "../../../modules/klip-speech"

const TYPEFACES = [
	{ id: "serif", label: t("account.account.serif") },
	{ id: "sans", label: t("account.account.sans") },
] as const

/**
 * The account, as Settings on the web holds it, in the iPhone's form: who is signed in, where the
 * account stands against its caps this month, how the reader looks, the library's export, and the
 * settings that stay on the web. Signing out and deleting the account at the foot.
 */
export default function Account() {
	const { state, apiUrl, signOut, imageHeaders } = useAuth()
	const colors = useColors()
	const client = state.status === "signed-in" ? state.client : null
	const host = apiUrl.replace(/^https?:\/\//, "")
	const [me, setMe] = useState<Me | null>(null)
	const [usage, setUsage] = useState<Usage | "failed" | null>(null)
	const [scheme, setScheme] = useState(loadColorScheme)
	const [type, setType] = useState(loadTypePrefs)
	const [exporting, setExporting] = useState(false)
	// With AI answers on: whether questions may go to the AI provider (null: not loaded).
	const [ai, setAi] = useState<{ consentedAt: string | null } | null>(null)

	const load = useCallback(() => {
		if (!client) return
		void client.me().then(setMe, () => {})
		client.ai.status().then(
			(status) => setAi(status.enabled ? { consentedAt: status.consentedAt ?? null } : null),
			() => {},
		)
		client.usage().then(setUsage, () => setUsage("failed"))
		// setUsage never changes; listed because the React Compiler's lint can't tell here.
	}, [client, setUsage])
	useEffect(load, [load])

	function chooseScheme(next: ColorSchemePref) {
		setScheme(next)
		saveColorScheme(next)
		applyColorScheme(next)
	}

	function chooseTypeface(next: "serif" | "sans") {
		const prefs = { ...type, sans: next === "sans" }
		setType(prefs)
		saveTypePrefs(prefs)
	}

	async function exportAll() {
		setExporting(true)
		try {
			await exportLibrary(apiUrl, await imageHeaders())
		} catch {
			Alert.alert(t("account.account.library.failed"), t("account.account.tryAgain"))
		} finally {
			setExporting(false)
		}
	}

	async function setConsent(consented: boolean) {
		if (!client) return
		try {
			setAi(await client.ai.consent(consented))
		} catch {
			Alert.alert(t("account.account.ai.failed"), t("account.account.tryAgain"))
		}
	}

	function changeConsent() {
		if (ai?.consentedAt)
			Alert.alert(t("account.account.ai.stopTitle"), t("account.account.ai.stopMessage"), [
				{ text: t("common.actions.cancel"), style: "cancel" },
				{
					text: t("account.account.ai.stop"),
					style: "destructive",
					onPress: () => void setConsent(false),
				},
			])
		else
			Alert.alert(AI_CONSENT.title, AI_CONSENT.sent, [
				{ text: t("account.account.ai.notNow"), style: "cancel" },
				{ text: t("account.account.ai.allow"), onPress: () => void setConsent(true) },
			])
	}

	function confirmSignOut() {
		Alert.alert(t("account.account.signOutTitle"), t("account.account.signOutMessage", { host }), [
			{ text: t("common.actions.cancel"), style: "cancel" },
			{ text: t("account.account.signOut"), style: "destructive", onPress: () => void signOut() },
		])
	}

	const web = (path: string) => () => openOnTheWeb(`${apiUrl}${path}`)

	return (
		<ScrollView
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={listStyles.content}
			contentInsetAdjustmentBehavior="automatic"
		>
			<View
				style={styles.who}
				accessible
				accessibilityLabel={
					me ? t("account.account.who", { name: me.name, email: me.email, host }) : undefined
				}
			>
				<Text style={[styles.name, { color: colors.fg }]} numberOfLines={1}>
					{me?.name ?? " "}
				</Text>
				<Text style={[styles.email, { color: colors.mutedFg }]} numberOfLines={1}>
					{me?.email ?? " "}
				</Text>
				<Text style={[styles.server, { color: colors.mutedFg }]}>
					{t("account.account.signedInTo", { host })}
				</Text>
			</View>

			<Section
				title={t("account.account.usage")}
				footnote={
					usage && usage !== "failed"
						? t("account.account.resets", { date: resetsOn(usage.resetsAt) })
						: undefined
				}
			>
				{usage === null ? (
					<View style={styles.loading}>
						<ActivityIndicator color={colors.mutedFg} />
					</View>
				) : usage === "failed" ? (
					<Row
						label={t("account.account.usageFailed")}
						onPress={() => {
							setUsage(null)
							load()
						}}
					/>
				) : (
					usageRows(usage, { editions: me?.editions ?? true, feeds: me?.feeds ?? true }).map(
						(row) => <Meter key={row.key} row={row} colors={colors} />,
					)
				)}
			</Section>

			<Section title={t("account.account.reading")}>
				<Choices
					label={t("account.account.appearance")}
					options={COLOR_SCHEMES}
					value={scheme}
					onChange={chooseScheme}
				/>
				<Choices
					label={t("account.account.text")}
					options={TYPEFACES}
					value={type.sans ? "sans" : "serif"}
					onChange={chooseTypeface}
				/>
				{speech ? (
					<Row
						label={t("account.account.voices")}
						push
						onPress={() => router.push("/account/voices")}
					/>
				) : null}
			</Section>

			{ai ? (
				<Section title={t("account.account.ai.title")} footnote={t("account.account.ai.footnote")}>
					<Row
						label={t("account.account.ai.send")}
						value={
							ai.consentedAt ? t("account.account.ai.allowed") : t("account.account.ai.askFirst")
						}
						onPress={changeConsent}
					/>
				</Section>
			) : null}

			<Section
				title={t("account.account.library.title")}
				footnote={t("account.account.library.footnote")}
			>
				<Row
					label={t("account.account.library.export")}
					busy={exporting}
					onPress={() => void exportAll()}
				/>
			</Section>

			<Section title={t("account.account.web.title")} footnote={t("account.account.web.footnote")}>
				<Row label={t("account.account.web.signIn")} web onPress={web("/settings/account")} />
				<Row label={t("account.account.web.features")} web onPress={web("/settings/features")} />
				<Row
					label={t("account.account.web.connectedApps")}
					web
					onPress={web("/settings/connected-apps")}
				/>
				<Row label={t("account.account.web.terms")} web onPress={web("/terms")} />
				<Row label={t("account.account.web.privacy")} web onPress={web("/privacy")} />
			</Section>

			<Section>
				<Row label={t("account.account.signOut")} danger onPress={confirmSignOut} />
				<Row
					label={t("account.account.deleteAccount")}
					danger
					push
					onPress={() => router.push("/account/delete")}
				/>
			</Section>

			<Text style={[styles.version, { color: colors.mutedFg }]}>Klipstack {APP_VERSION}</Text>
		</ScrollView>
	)
}

/** One cap: what it counts, how much of it is used, and a bar that warns near it and at it. */
function Meter({ row, colors }: { row: UsageRow; colors: Colors }) {
	const fill =
		row.level === "full" ? colors.danger : row.level === "near" ? colors.favorite : colors.accent
	return (
		<View
			accessible
			accessibilityRole="progressbar"
			accessibilityLabel={row.label}
			accessibilityValue={{ text: [row.amount, row.left].filter(Boolean).join(", ") }}
			style={styles.meter}
		>
			<View style={styles.meterLine}>
				<Text style={[styles.meterLabel, { color: colors.fg }]}>{row.label}</Text>
				<Text
					style={[
						styles.meterAmount,
						{ color: row.level === "full" ? colors.danger : colors.mutedFg },
					]}
				>
					{row.left ? `${row.amount} · ${row.left}` : row.amount}
				</Text>
			</View>
			<View style={[styles.track, { backgroundColor: colors.muted }]}>
				<View style={[styles.fill, { backgroundColor: fill, width: `${row.share * 100}%` }]} />
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	who: { alignItems: "center", gap: 2, paddingTop: 8 },
	name: { fontFamily: fonts.display, fontSize: 26 },
	email: { fontSize: 15 },
	server: { fontSize: 13, marginTop: 4 },
	loading: { paddingVertical: 24 },
	meter: { paddingVertical: 12, paddingHorizontal: 16, gap: 8 },
	meterLine: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "baseline",
		gap: 12,
	},
	meterLabel: { fontSize: 17 },
	meterAmount: { fontSize: 15, fontVariant: ["tabular-nums"] },
	track: { height: 4, borderRadius: 2, overflow: "hidden" },
	fill: { height: 4, borderRadius: 2 },
	version: { fontSize: 13, textAlign: "center" },
})
