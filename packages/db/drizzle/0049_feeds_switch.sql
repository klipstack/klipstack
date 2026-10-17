-- Feeds become a switch in the account's Settings, off unless turned on. Accounts that already
-- follow a feed keep them on.
UPDATE "user" SET "prefs" = "prefs" || '{"feeds": "on"}'::jsonb
WHERE "id" IN (SELECT "user_id" FROM "subscriptions");
