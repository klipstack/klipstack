CREATE INDEX "auth_limits_reset_idx" ON "auth_limits" USING btree ("reset_at");--> statement-breakpoint
-- Historical verified accounts have no verification timestamp, so an old key cannot be
-- distinguished from one planted before verification. Reissue all existing API keys once.
UPDATE api_keys SET revoked_at = now() WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION revoke_deleted_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM oauth_grants WHERE user_id = OLD.user_id AND client_id = OLD.client_id;
  DELETE FROM oauth_refresh_token WHERE user_id = OLD.user_id AND client_id = OLD.client_id;
  DELETE FROM oauth_access_token WHERE user_id = OLD.user_id AND client_id = OLD.client_id;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
-- Cover the provider's direct consent-delete endpoint as well as Settings.
CREATE TRIGGER oauth_consent_deleted AFTER DELETE ON oauth_consent
FOR EACH ROW EXECUTE FUNCTION revoke_deleted_consent();
