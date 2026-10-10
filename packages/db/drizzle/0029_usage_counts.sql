CREATE TABLE "usage_counts" (
	"user_id" text NOT NULL,
	"metric" text NOT NULL,
	"month" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counts_user_id_metric_month_pk" PRIMARY KEY("user_id","metric","month")
);
--> statement-breakpoint
ALTER TABLE "usage_counts" ADD CONSTRAINT "usage_counts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;