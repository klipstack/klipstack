CREATE INDEX "document_links_highlight_idx" ON "document_links" USING btree ("highlight_id");--> statement-breakpoint
CREATE INDEX "document_versions_raw_idx" ON "document_versions" USING btree ("raw_id");--> statement-breakpoint
CREATE INDEX "documents_user_inbox_created_idx" ON "documents" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "documents"."archived_at" is null and "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "feed_item_dismissals_item_idx" ON "feed_item_dismissals" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "feed_item_views_item_idx" ON "feed_item_views" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "highlights_version_idx" ON "highlights" USING btree ("version_id");