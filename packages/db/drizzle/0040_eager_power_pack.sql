CREATE TABLE "document_topics" (
	"document_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"probability" real NOT NULL,
	"level" text NOT NULL,
	"refused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_topics_document_id_topic_id_pk" PRIMARY KEY("document_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "topic_libraries" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposed_at_count" integer,
	"proposed_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"unsorted_at_last_grow" integer DEFAULT 0 NOT NULL,
	"sorted_since_review" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_sorts" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sorted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"origin" text NOT NULL,
	"named_by_reader" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "document_topics" ADD CONSTRAINT "document_topics_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_topics" ADD CONSTRAINT "document_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_libraries" ADD CONSTRAINT "topic_libraries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_sorts" ADD CONSTRAINT "topic_sorts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_sorts" ADD CONSTRAINT "topic_sorts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_topics_topic_idx" ON "document_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "topic_sorts_user_idx" ON "topic_sorts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "topics_user_status_idx" ON "topics" USING btree ("user_id","status");