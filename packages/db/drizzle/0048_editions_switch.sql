-- Editions become a switch in the account's Settings, off unless turned on. Accounts that already
-- use them (an edition, an article marked for the next one, or an edition note) keep them on.
UPDATE "user" SET "prefs" = "prefs" || '{"editions": "on"}'::jsonb
WHERE "id" IN (
	SELECT "user_id" FROM "editions"
	UNION
	SELECT "user_id" FROM "documents" WHERE "shortlisted_at" IS NOT NULL OR "edition_note" IS NOT NULL
);
