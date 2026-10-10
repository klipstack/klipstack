CREATE TABLE "invite_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"note" text,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "invite_requests_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "invite_requests_created_idx" ON "invite_requests" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);