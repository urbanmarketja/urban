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
