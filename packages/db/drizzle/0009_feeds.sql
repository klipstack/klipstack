CREATE TABLE "feed_item_dismissals" (
	"user_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_item_dismissals_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "feed_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"feed_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"title" text,
	"author" text,
	"excerpt" text,
	"published_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sort_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"title" text,
	"site_url" text,
	"etag" text,
	"last_modified" text,
	"last_fetched_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"next_fetch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feed_id" uuid NOT NULL,
	"title" text,
	"since" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_item_dismissals" ADD CONSTRAINT "feed_item_dismissals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item_dismissals" ADD CONSTRAINT "feed_item_dismissals_item_id_feed_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_items_feed_guid_unique" ON "feed_items" USING btree ("feed_id","guid");--> statement-breakpoint
CREATE INDEX "feed_items_feed_sort_idx" ON "feed_items" USING btree ("feed_id","sort_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "feeds_url_hash_unique" ON "feeds" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "feeds_next_fetch_idx" ON "feeds" USING btree ("next_fetch_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_feed_unique" ON "subscriptions" USING btree ("user_id","feed_id");--> statement-breakpoint
CREATE INDEX "subscriptions_feed_idx" ON "subscriptions" USING btree ("feed_id");