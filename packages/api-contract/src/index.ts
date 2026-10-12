export * from "./auth"
export * from "./details"
export * from "./endpoint"
export * from "./endpoints/account"
export * from "./endpoints/articles"
export * from "./endpoints/library"
export * from "./endpoints/meta"
export * from "./endpoints/writes"
export * from "./enums"
export * from "./errors"
export * from "./names"
export * from "./schemas"

import { getMe } from "./endpoints/account"
import {
	articleHtml,
	articleMarkdown,
	articleTopics,
	getArticle,
	listArticles,
	lookupArticles,
	previewLink,
	searchArticles,
} from "./endpoints/articles"
import {
	exportLibrary,
	getAsset,
	getFeed,
	listFeeds,
	listHighlights,
	listSavedSearches,
	listTags,
	listTopics,
} from "./endpoints/library"
import { getOpenApi } from "./endpoints/meta"
import {
	appendNote,
	createHighlight,
	createSavedSearch,
	createTag,
	deleteHighlight,
	deleteSavedSearch,
	deleteTag,
	dismissFeedItems,
	followFeed,
	markFeedViewed,
	openArticle,
	readPost,
	renameArticle,
	renameSavedSearch,
	renameTag,
	restoreArticles,
	saveArticle,
	saveFeedItems,
	setEditionNote,
	setNote,
	setPosition,
	trashArticles,
	unfollowFeed,
	undoArticles,
	updateArticles,
	resizeHighlight,
	updateHighlight,
} from "./endpoints/writes"

/** Every endpoint, keyed by its id. The server binds a handler to each; the SDK calls them by id. */
export const endpoints = {
	"me.get": getMe,
	"articles.list": listArticles,
	"articles.search": searchArticles,
	"articles.lookup": lookupArticles,
	"links.preview": previewLink,
	"articles.get": getArticle,
	"articles.markdown": articleMarkdown,
	"articles.html": articleHtml,
	"articles.topics": articleTopics,
	"articles.save": saveArticle,
	"articles.update": updateArticles,
	"articles.undo": undoArticles,
	"articles.rename": renameArticle,
	"articles.trash": trashArticles,
	"articles.restore": restoreArticles,
	"articles.open": openArticle,
	"articles.readPost": readPost,
	"articles.setPosition": setPosition,
	"articles.setNote": setNote,
	"articles.setEditionNote": setEditionNote,
	"articles.appendNote": appendNote,
	"assets.get": getAsset,
	"highlights.list": listHighlights,
	"highlights.create": createHighlight,
	"highlights.update": updateHighlight,
	"highlights.resize": resizeHighlight,
	"highlights.delete": deleteHighlight,
	"feed.get": getFeed,
	"feed.saveItems": saveFeedItems,
	"feed.dismissItems": dismissFeedItems,
	"feed.markViewed": markFeedViewed,
	"feeds.list": listFeeds,
	"feeds.follow": followFeed,
	"feeds.unfollow": unfollowFeed,
	"tags.list": listTags,
	"tags.create": createTag,
	"tags.rename": renameTag,
	"tags.delete": deleteTag,
	"topics.list": listTopics,
	"savedSearches.list": listSavedSearches,
	"savedSearches.create": createSavedSearch,
	"savedSearches.rename": renameSavedSearch,
	"savedSearches.delete": deleteSavedSearch,
	"export.get": exportLibrary,
	"openapi.get": getOpenApi,
} as const

export type Endpoints = typeof endpoints
export type EndpointId = keyof Endpoints
