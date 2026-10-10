-- Existing unverified credentials are not proof of mailbox ownership. OAuth clients
-- must reconnect to receive generation-bound tokens. See 0014 for legacy API keys.
CREATE TABLE "auth_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"generation" text NOT NULL,
	CONSTRAINT "oauth_grants_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
UPDATE api_keys SET revoked_at = now() WHERE user_id IN (SELECT id FROM "user" WHERE NOT email_verified) AND revoked_at IS NULL;
--> statement-breakpoint
DELETE FROM oauth_refresh_token WHERE user_id IN (SELECT id FROM "user" WHERE NOT email_verified);
--> statement-breakpoint
DELETE FROM oauth_access_token WHERE user_id IN (SELECT id FROM "user" WHERE NOT email_verified);
--> statement-breakpoint
DELETE FROM oauth_consent WHERE user_id IN (SELECT id FROM "user" WHERE NOT email_verified);
--> statement-breakpoint
CREATE FUNCTION revoke_unverified_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email_verified AND NOT OLD.email_verified THEN
    UPDATE api_keys SET revoked_at = now() WHERE user_id = NEW.id AND revoked_at IS NULL;
    DELETE FROM oauth_grants WHERE user_id = NEW.id;
    DELETE FROM oauth_consent WHERE user_id = NEW.id;
    DELETE FROM oauth_refresh_token WHERE user_id = NEW.id;
    DELETE FROM oauth_access_token WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_first_verification BEFORE UPDATE OF email_verified ON "user"
FOR EACH ROW EXECUTE FUNCTION revoke_unverified_credentials();
