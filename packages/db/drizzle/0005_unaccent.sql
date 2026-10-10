-- Accent-insensitive search ("decision" finds "decisión"). A trusted extension: the database owner
-- can create it without superuser rights.
CREATE EXTENSION IF NOT EXISTS unaccent;
