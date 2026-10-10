-- Saved X links were all extracted as "article" (the column default). Mark them as posts, as the
-- filters treated them until now; re-extracting them promotes the real X Articles.
UPDATE "documents" SET "type" = 'post' WHERE "source_url" LIKE 'https://x.com/%';
