import type { Me, Usage } from "@klipstack/sdk"
import { router } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native"
import { Choices, listStyles, Row, Section } from "@/components/grouped-list"
import { useAuth } from "@/lib/auth"
import { COLOR_SCHEMES, type ColorSchemePref } from "@/lib/color-scheme"
import { APP_VERSION } from "@/lib/config"
import { exportLibrary } from "@/lib/library-export"
import { loadColorScheme, loadTypePrefs, saveColorScheme, saveTypePrefs } from "@/lib/reader-files"
import { applyColorScheme, type Colors, fonts, useColors } from "@/lib/theme"
import { resetsOn, type UsageRow, usageRows } from "@/lib/usage"
import { speech } from "../../../modules/klip-speech"

const TYPEFACES = [
	{ id: "serif", label: "Serif" },
	{ id: "sans", label: "Sans" },
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

	const load = useCallback(() => {
		if (!client) return
		void client.me().then(setMe, () => {})
		client.usage().then(setUsage, () => setUsage("failed"))
	}, [client])
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
			Alert.alert("Couldn't export the library", "Try again in a moment.")
		} finally {
			setExporting(false)
		}
	}

	function confirmSignOut() {
		Alert.alert("Sign out?", `You'll need to sign in to ${host} again.`, [
			{ text: "Cancel", style: "cancel" },
			{ text: "Sign out", style: "destructive", onPress: () => void signOut() },
		])
	}

	const web = (path: string) => () => void WebBrowser.openBrowserAsync(`${apiUrl}${path}`)

	return (
		<ScrollView
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={listStyles.content}
			contentInsetAdjustmentBehavior="automatic"
		>
			<View
				style={styles.who}
				accessible
				accessibilityLabel={me ? `${me.name}, ${me.email}, signed in to ${host}` : undefined}
			>
				<Text style={[styles.name, { color: colors.fg }]} numberOfLines={1}>
					{me?.name ?? " "}
				</Text>
				<Text style={[styles.email, { color: colors.mutedFg }]} numberOfLines={1}>
					{me?.email ?? " "}
				</Text>
				<Text style={[styles.server, { color: colors.mutedFg }]}>Signed in to {host}</Text>
			</View>

			<Section
				title="Usage this month"
				footnote={
					usage && usage !== "failed"
						? `Monthly counts start over on ${resetsOn(usage.resetsAt)}.`
						: undefined
				}
			>
				{usage === null ? (
					<View style={styles.loading}>
						<ActivityIndicator color={colors.mutedFg} />
					</View>
				) : usage === "failed" ? (
					<Row
						label="Couldn't load usage. Try again"
						onPress={() => {
							setUsage(null)
							load()
						}}
					/>
				) : (
					usageRows(usage).map((row) => <Meter key={row.key} row={row} colors={colors} />)
				)}
			</Section>

			<Section title="Reading">
				<Choices
					label="Appearance"
					options={COLOR_SCHEMES}
					value={scheme}
					onChange={chooseScheme}
				/>
				<Choices
					label="Text"
					options={TYPEFACES}
					value={type.sans ? "sans" : "serif"}
					onChange={chooseTypeface}
				/>
				{speech ? <Row label="Voices" push onPress={() => router.push("/account/voices")} /> : null}
			</Section>

			<Section
				title="Your library"
				footnote="A zip of every article as Markdown, with its highlights and notes, and the whole library as JSON."
			>
				<Row label="Export library" busy={exporting} onPress={() => void exportAll()} />
			</Section>

			<Section title="On the web" footnote="These settings stay on the web, in your browser.">
				<Row label="Ways to sign in" web onPress={web("/settings/account")} />
				<Row label="API keys" web onPress={web("/settings/api-keys")} />
				<Row label="Connected apps" web onPress={web("/settings/connected-apps")} />
				<Row label="Terms of service" web onPress={web("/terms")} />
				<Row label="Privacy policy" web onPress={web("/privacy")} />
			</Section>

			<Section>
				<Row label="Sign out" danger onPress={confirmSignOut} />
				<Row label="Delete account" danger push onPress={() => router.push("/account/delete")} />
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
