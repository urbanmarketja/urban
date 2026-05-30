CREATE TABLE IF NOT EXISTS store_social_links (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  store_id CHAR(36) NOT NULL,
  platform ENUM('facebook', 'instagram', 'whatsapp', 'tiktok', 'x', 'youtube', 'website') NOT NULL,
  label VARCHAR(120),
  url VARCHAR(500) NOT NULL,
  status ENUM('active', 'hidden') NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_store_social_links_store_platform (store_id, platform),
  CONSTRAINT fk_store_social_links_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_store_social_links_store_id ON store_social_links(store_id);
