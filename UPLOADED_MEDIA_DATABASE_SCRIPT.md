# Uploaded Media Database Script

This script adds database-backed storage for uploaded marketplace files. It helps product photos, service photos, store media, resumes, vendor documents, and customization images survive Render deploys or filesystem resets.

Run this on the online Aiven database before relying on new uploads:

```sql
CREATE TABLE IF NOT EXISTS uploaded_media (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  storage_key_hash CHAR(64) NOT NULL UNIQUE,
  storage_key VARCHAR(700) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  media_group ENUM('listing', 'customization', 'vendor_document', 'resume') NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  data LONGBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_uploaded_media_group ON uploaded_media(media_group);
CREATE INDEX idx_uploaded_media_file_name ON uploaded_media(file_name);
```

The same SQL is also available in:

- `database/migrations/016_uploaded_media_storage.sql`
- `Backend/db/migrations/016_uploaded_media_storage.sql`

Existing product image rows that point to missing Render files cannot be recovered by this table. Those images need to be re-uploaded once this migration is live.
