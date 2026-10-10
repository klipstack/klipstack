import type { Endpoints } from "@klipstack/api-contract"
import type { HandlerTable } from "../handler.server"
import { me } from "./account.server"
import * as articles from "./articles.server"
import * as library from "./library.server"
import { openapi } from "./meta.server"
import * as writes from "./writes.server"

/** One handler per endpoint id; a missing one fails the typecheck. */
export const handlers: HandlerTable<Endpoints> = {
	"me.get": me,
	"articles.list": articles.list,
	"articles.search": articles.search,
	"articles.suggest": articles.suggest,
	"articles.lookup": articles.lookup,
	"links.preview": articles.preview,
	"articles.get": articles.get,
	"articles.markdown": articles.markdown,
	"articles.html": articles.html,
	"articles.save": writes.save,
	"articles.update": writes.update,
	"articles.undo": writes.undo,
	"articles.rename": writes.rename,
	"articles.trash": writes.trash,
	"articles.restore": writes.restore,
	"articles.open": writes.open,
	"articles.readPost": writes.readPost,
	"articles.setPosition": writes.position,
	"articles.setNote": writes.replaceNote,
	"articles.appendNote": writes.append,
	"articles.setEditionNote": writes.replaceEditionNote,
	"assets.get": library.asset,
	"highlights.list": library.highlights,
	"highlights.create": writes.addHighlight,
	"highlights.update": writes.editHighlight,
	"highlights.resize": writes.moveHighlight,
	"highlights.delete": writes.removeOne,
	"feed.get": library.feed,
	"feed.saveItems": writes.saveItems,
	"feed.dismissItems": writes.dismissItems,
	"feed.markViewed": writes.viewed,
	"feeds.list": library.feeds,
	"feeds.follow": writes.follow,
	"feeds.unfollow": writes.unfollow,
	"tags.list": library.tags,
	"tags.create": writes.addTag,
	"tags.rename": writes.retitleTag,
	"tags.delete": writes.removeTag,
	"savedSearches.list": library.savedSearches,
	"savedSearches.create": writes.addSavedSearch,
	"savedSearches.rename": writes.retitleSavedSearch,
	"savedSearches.delete": writes.removeSavedSearch,
	"export.get": library.exportAll,
	"openapi.get": openapi,
}
