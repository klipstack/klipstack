CREATE TABLE "key_checks" (
	"provider" text PRIMARY KEY NOT NULL,
	"result" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alerted_at" timestamp with time zone,
	CONSTRAINT "key_checks_provider_check" CHECK ("key_checks"."provider" in ('anthropic', 'typesafe', 'resend', 'storage')),
	CONSTRAINT "key_checks_result_check" CHECK ("key_checks"."result" in ('working', 'rejected', 'unchecked', 'unset'))
);
