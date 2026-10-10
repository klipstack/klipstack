-- A capture that failed after an earlier one succeeded marked the article failed, which hid its
-- readable version and its highlights. The worker now keeps such an article ready; this puts back
-- the ones it hid.
UPDATE "documents" SET "status" = 'ready' WHERE "status" = 'failed' AND "current_version_id" IS NOT NULL;
