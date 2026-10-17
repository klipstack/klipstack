export * from "./auth"
export * from "./details"
export * from "./endpoint"
export * from "./endpoints/account"
export * from "./endpoints/ai"
export * from "./endpoints/articles"
export * from "./endpoints/home"
export * from "./endpoints/library"
export * from "./endpoints/meta"
export * from "./endpoints/notebook"
export * from "./endpoints/review"
export * from "./endpoints/topics"
export * from "./endpoints/writes"
export * from "./enums"
export * from "./errors"
export * from "./names"
export * from "./schemas"

import { deleteAccount, getMe, getUsage } from "./endpoints/account"
import {
	articleAi,
	askAi,
	briefAi,
	chatAi,
	deleteAiThread,
	followUpAi,
	getAi,
	restoreAiThread,
	retryAi,
} from "./endpoints/ai"
import {
	articleHtml,
	articleMarkdown,
	articleTopics,
	countArticles,
	getArticle,
	listArticles,
	lookupArticles,
	previewLink,
	searchArticles,
} from "./endpoints/articles"
import {
	getFinishedLately,
	getNextEdition,
	listRediscover,
	snoozeNextEdition,
} from "./endpoints/home"
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
	dismissDailyHighlight,
	getNotebook,
	listDailyHighlights,
	listNoteReminders,
	restoreDailyHighlight,
	searchAnnotations,
	skipNote,
	snoozeNoteReminders,
	unskipNote,
} from "./endpoints/notebook"
import { getReviewSuggestion, listReview, snoozeReview } from "./endpoints/review"
import {
	confirmTopics,
	countTopicUse,
	disableTopics,
	dismissTopicsCard,
	enableTopics,
	endTopicsInvitation,
	markTopicsSeen,
	removeTopic,
	renameTopic,
	takeOutOfTopic,
} from "./endpoints/topics"
import {
	appendNote,
	archiveReadArticles,
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
	purgeArticles,
	readPost,
	retryArticle,
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
	restoreHighlight,
	updateHighlight,
} from "./endpoints/writes"

/** Every endpoint, keyed by its id. The server binds a handler to each; the SDK calls them by id. */
export const endpoints = {
	"me.get": getMe,
	"articles.list": listArticles,
	"articles.counts": countArticles,
	"articles.search": searchArticles,
	"annotations.search": searchAnnotations,
	"articles.lookup": lookupArticles,
	"links.preview": previewLink,
	"articles.get": getArticle,
	"articles.markdown": articleMarkdown,
	"articles.html": articleHtml,
	"articles.topics": articleTopics,
	"articles.save": saveArticle,
	"articles.update": updateArticles,
	"articles.undo": undoArticles,
	"articles.archiveRead": archiveReadArticles,
	"articles.rename": renameArticle,
	"articles.trash": trashArticles,
	"articles.restore": restoreArticles,
	"articles.open": openArticle,
	"articles.purge": purgeArticles,
	"articles.readPost": readPost,
	"articles.retry": retryArticle,
	"articles.setPosition": setPosition,
	"articles.setNote": setNote,
	"articles.setEditionNote": setEditionNote,
	"articles.appendNote": appendNote,
	"articles.skipNote": skipNote,
	"articles.unskipNote": unskipNote,
	"assets.get": getAsset,
	"highlights.list": listHighlights,
	"highlights.create": createHighlight,
	"highlights.update": updateHighlight,
	"highlights.resize": resizeHighlight,
	"highlights.delete": deleteHighlight,
	"highlights.restore": restoreHighlight,
	"notebook.get": getNotebook,
	"dailyHighlights.list": listDailyHighlights,
	"dailyHighlights.dismiss": dismissDailyHighlight,
	"dailyHighlights.restore": restoreDailyHighlight,
	"noteReminders.list": listNoteReminders,
	"noteReminders.snooze": snoozeNoteReminders,
	"home.finished": getFinishedLately,
	"home.rediscover": listRediscover,
	"editions.next": getNextEdition,
	"editions.snoozeNudge": snoozeNextEdition,
	"review.list": listReview,
	"review.suggested": getReviewSuggestion,
	"review.snooze": snoozeReview,
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
	"topics.enable": enableTopics,
	"topics.disable": disableTopics,
	"topics.confirm": confirmTopics,
	"topics.seen": markTopicsSeen,
	"topics.dismissCard": dismissTopicsCard,
	"topics.endInvitation": endTopicsInvitation,
	"topics.rename": renameTopic,
	"topics.remove": removeTopic,
	"topics.takeOut": takeOutOfTopic,
	"topics.countUse": countTopicUse,
	"savedSearches.list": listSavedSearches,
	"savedSearches.create": createSavedSearch,
	"savedSearches.rename": renameSavedSearch,
	"savedSearches.delete": deleteSavedSearch,
	"export.get": exportLibrary,
	"ai.get": getAi,
	"ai.article": articleAi,
	"ai.ask": askAi,
	"ai.chat": chatAi,
	"ai.followUp": followUpAi,
	"ai.retry": retryAi,
	"ai.delete": deleteAiThread,
	"ai.restore": restoreAiThread,
	"ai.brief": briefAi,
	"usage.get": getUsage,
	"account.delete": deleteAccount,
	"openapi.get": getOpenApi,
} as const

export type Endpoints = typeof endpoints
export type EndpointId = keyof Endpoints
