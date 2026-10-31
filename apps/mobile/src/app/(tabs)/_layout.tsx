import { NativeTabs } from "expo-router/native-tabs"
import { DynamicColorIOS } from "react-native"
import { t } from "@/lib/i18n"
import { useTabBarHidden } from "@/lib/tab-bar"

// The accent (src/lib/theme.ts) for the selected tab, in light and dark.
const accent = DynamicColorIOS({ light: "#243f6c", dark: "#7faee9" })

/**
 * The main sections, in iOS's own tab bar: Liquid Glass on iOS 26, and a separate search button
 * (`role="search"`). Library holds the lists of articles (Inbox, Starred, Archive, Trash), so the
 * bar keeps room. Each tab has its own stack; the reader opens over them, full screen. A list
 * selecting articles hides the bar and puts its actions there instead, as Photos does.
 */
export default function TabsLayout() {
	return (
		<NativeTabs
			tintColor={accent}
			minimizeBehavior="onScrollDown"
			disableTransparentOnScrollEdge
			hidden={useTabBarHidden()}
		>
			<NativeTabs.Trigger name="(home)">
				<NativeTabs.Trigger.Label>{t("common.tabs.home")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="library">
				<NativeTabs.Trigger.Label>{t("common.tabs.library")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon
					sf={{ default: "books.vertical", selected: "books.vertical.fill" }}
					md="library_books"
				/>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="notebook">
				<NativeTabs.Trigger.Label>{t("common.tabs.notebook")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon
					sf={{ default: "book.closed", selected: "book.closed.fill" }}
					md="menu_book"
				/>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="search" role="search">
				<NativeTabs.Trigger.Label>{t("common.tabs.search")}</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	)
}
