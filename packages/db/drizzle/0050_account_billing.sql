CREATE TABLE "account_billing" (
	"user_id" text PRIMARY KEY NOT NULL,
	"free_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_billing" ADD CONSTRAINT "account_billing_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;