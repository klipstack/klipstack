-- Posts on X were saved with the site name "X", which reads like a close button. It is "X.com" now.
UPDATE "documents" SET "site_name" = 'X.com' WHERE "site_name" = 'X' AND "source_url" LIKE 'https://x.com/%';
--> statement-breakpoint
UPDATE "edition_items" SET "site_name" = 'X.com' WHERE "site_name" = 'X' AND "url" LIKE 'https://x.com/%';
