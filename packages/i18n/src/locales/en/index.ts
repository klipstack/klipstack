import type { ResourceLanguage } from "i18next"
import admin from "./admin"
import auth from "./auth"
import common from "./common"
import editions from "./editions"
import feed from "./feed"
import library from "./library"
import reader from "./reader"
import settings from "./settings"

export default {
	common,
	auth,
	settings,
	library,
	reader,
	feed,
	admin,
	editions,
} satisfies ResourceLanguage
