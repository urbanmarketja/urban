-- Urban Market JA online database update for customizable products and durable uploads.
-- Run this once on the Aiven MySQL database before using customizable products online.

SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'cart_items'
    AND column_name = 'customization_signature'
);

SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE cart_items ADD COLUMN customization_signature VARCHAR(80) NOT NULL DEFAULT '''' AFTER unit_price_jmd',
  'SELECT "cart_items.customization_signature already exists" AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'cart_items'
    AND index_name = 'uq_cart_items_cart_product'
);

SET @sql = IF(
  @index_exists > 0,
  'ALTER TABLE cart_items DROP INDEX uq_cart_items_cart_product',
  'SELECT "uq_cart_items_cart_product already removed" AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'cart_items'
    AND index_name = 'uq_cart_items_cart_product_customization'
);

SET @sql = IF(
  @index_exists = 0,
  'CREATE UNIQUE INDEX uq_cart_items_cart_product_customization ON cart_items(cart_id, product_id, customization_signature)',
  'SELECT "uq_cart_items_cart_product_customization already exists" AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS product_customization_templates (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  product_id CHAR(36) NOT NULL,
  product_type VARCHAR(80) NOT NULL DEFAULT 'other',
  title VARCHAR(180),
  instructions TEXT,
  preview_mode ENUM('form', 'live_preview') NOT NULL DEFAULT 'live_preview',
  status ENUM('draft', 'active', 'paused') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_customization_templates_product (product_id),
  CONSTRAINT fk_product_customization_templates_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_customization_surfaces (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  template_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  surface_key VARCHAR(80) NOT NULL,
  base_image_url TEXT,
  width_px INT,
  height_px INT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_customization_surfaces_key (template_id, surface_key),
  CONSTRAINT fk_product_customization_surfaces_template FOREIGN KEY (template_id) REFERENCES product_customization_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_customization_fields (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  template_id CHAR(36) NOT NULL,
  field_key VARCHAR(80) NOT NULL,
  label VARCHAR(160) NOT NULL,
  field_type ENUM('text', 'number', 'color', 'select', 'checkbox', 'image') NOT NULL,
  placeholder VARCHAR(220),
  help_text TEXT,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  default_value TEXT,
  min_length INT,
  max_length INT,
  min_value DECIMAL(12,2),
  max_value DECIMAL(12,2),
  price_delta_jmd INT NOT NULL DEFAULT 0 CHECK (price_delta_jmd >= 0),
  status ENUM('active', 'hidden') NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_customization_fields_key (template_id, field_key),
  CONSTRAINT fk_product_customization_fields_template FOREIGN KEY (template_id) REFERENCES product_customization_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_customization_field_options (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  field_id CHAR(36) NOT NULL,
  option_value VARCHAR(160) NOT NULL,
  label VARCHAR(160) NOT NULL,
  swatch_color VARCHAR(32),
  price_delta_jmd INT NOT NULL DEFAULT 0 CHECK (price_delta_jmd >= 0),
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('active', 'hidden') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_customization_field_options_value (field_id, option_value),
  CONSTRAINT fk_product_customization_field_options_field FOREIGN KEY (field_id) REFERENCES product_customization_fields(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_customization_placements (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  field_id CHAR(36) NOT NULL,
  surface_id CHAR(36) NOT NULL,
  x_percent DECIMAL(6,3) NOT NULL DEFAULT 50.000,
  y_percent DECIMAL(6,3) NOT NULL DEFAULT 50.000,
  width_percent DECIMAL(6,3) NOT NULL DEFAULT 30.000,
  height_percent DECIMAL(6,3) NOT NULL DEFAULT 10.000,
  rotation_degrees DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  font_family VARCHAR(120),
  font_size_percent DECIMAL(6,3),
  font_weight VARCHAR(40),
  text_align ENUM('left', 'center', 'right') NOT NULL DEFAULT 'center',
  text_color VARCHAR(32),
  background_color VARCHAR(32),
  z_index INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_customization_placements_field_surface (field_id, surface_id),
  CONSTRAINT fk_product_customization_placements_field FOREIGN KEY (field_id) REFERENCES product_customization_fields(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_customization_placements_surface FOREIGN KEY (surface_id) REFERENCES product_customization_surfaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cart_item_customizations (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  cart_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  customization_signature VARCHAR(80) NOT NULL DEFAULT '',
  field_id CHAR(36),
  field_key VARCHAR(80) NOT NULL,
  field_label VARCHAR(160) NOT NULL,
  field_type VARCHAR(40) NOT NULL,
  value_text TEXT,
  value_json JSON,
  price_delta_jmd INT NOT NULL DEFAULT 0 CHECK (price_delta_jmd >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cart_item_customizations_field (cart_id, product_id, customization_signature, field_key),
  CONSTRAINT fk_cart_item_customizations_cart_item FOREIGN KEY (cart_id, product_id, customization_signature) REFERENCES cart_items(cart_id, product_id, customization_signature) ON DELETE CASCADE,
  CONSTRAINT fk_cart_item_customizations_field FOREIGN KEY (field_id) REFERENCES product_customization_fields(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cart_item_customization_previews (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  cart_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  customization_signature VARCHAR(80) NOT NULL DEFAULT '',
  surface_key VARCHAR(80) NOT NULL,
  preview_image_url TEXT,
  preview_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cart_item_customization_previews_surface (cart_id, product_id, customization_signature, surface_key),
  CONSTRAINT fk_cart_item_customization_previews_cart_item FOREIGN KEY (cart_id, product_id, customization_signature) REFERENCES cart_items(cart_id, product_id, customization_signature) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_item_customizations (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  order_item_id CHAR(36) NOT NULL,
  field_id CHAR(36),
  field_key VARCHAR(80) NOT NULL,
  field_label VARCHAR(160) NOT NULL,
  field_type VARCHAR(40) NOT NULL,
  value_text TEXT,
  value_json JSON,
  price_delta_jmd INT NOT NULL DEFAULT 0 CHECK (price_delta_jmd >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_item_customizations_field (order_item_id, field_key),
  CONSTRAINT fk_order_item_customizations_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_item_customizations_field FOREIGN KEY (field_id) REFERENCES product_customization_fields(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_item_customization_previews (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  order_item_id CHAR(36) NOT NULL,
  surface_key VARCHAR(80) NOT NULL,
  preview_image_url TEXT,
  preview_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_item_customization_previews_surface (order_item_id, surface_key),
  CONSTRAINT fk_order_item_customization_previews_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customization_audit_logs (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  order_id CHAR(36),
  order_item_id CHAR(36),
  product_id CHAR(36),
  vendor_id CHAR(36),
  actor_user_id CHAR(36),
  actor_role VARCHAR(40),
  action VARCHAR(100) NOT NULL,
  details JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customization_audit_logs_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_customization_audit_logs_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_customization_audit_logs_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_customization_audit_logs_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
  CONSTRAINT fk_customization_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_customization_templates' AND index_name = 'idx_product_customization_templates_product_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_product_customization_templates_product_id ON product_customization_templates(product_id)', 'SELECT "idx_product_customization_templates_product_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_customization_surfaces' AND index_name = 'idx_product_customization_surfaces_template_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_product_customization_surfaces_template_id ON product_customization_surfaces(template_id)', 'SELECT "idx_product_customization_surfaces_template_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_customization_fields' AND index_name = 'idx_product_customization_fields_template_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_product_customization_fields_template_id ON product_customization_fields(template_id)', 'SELECT "idx_product_customization_fields_template_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_customization_field_options' AND index_name = 'idx_product_customization_field_options_field_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_product_customization_field_options_field_id ON product_customization_field_options(field_id)', 'SELECT "idx_product_customization_field_options_field_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_customization_placements' AND index_name = 'idx_product_customization_placements_field_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_product_customization_placements_field_id ON product_customization_placements(field_id)', 'SELECT "idx_product_customization_placements_field_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'product_customization_placements' AND index_name = 'idx_product_customization_placements_surface_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_product_customization_placements_surface_id ON product_customization_placements(surface_id)', 'SELECT "idx_product_customization_placements_surface_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'cart_item_customizations' AND index_name = 'idx_cart_item_customizations_cart_product');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_cart_item_customizations_cart_product ON cart_item_customizations(cart_id, product_id, customization_signature)', 'SELECT "idx_cart_item_customizations_cart_product already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'cart_item_customization_previews' AND index_name = 'idx_cart_item_customization_previews_cart_product');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_cart_item_customization_previews_cart_product ON cart_item_customization_previews(cart_id, product_id, customization_signature)', 'SELECT "idx_cart_item_customization_previews_cart_product already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'order_item_customizations' AND index_name = 'idx_order_item_customizations_order_item_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_order_item_customizations_order_item_id ON order_item_customizations(order_item_id)', 'SELECT "idx_order_item_customizations_order_item_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'order_item_customization_previews' AND index_name = 'idx_order_item_customization_previews_order_item_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_order_item_customization_previews_order_item_id ON order_item_customization_previews(order_item_id)', 'SELECT "idx_order_item_customization_previews_order_item_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customization_audit_logs' AND index_name = 'idx_customization_audit_logs_order_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_customization_audit_logs_order_id ON customization_audit_logs(order_id)', 'SELECT "idx_customization_audit_logs_order_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customization_audit_logs' AND index_name = 'idx_customization_audit_logs_order_item_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_customization_audit_logs_order_item_id ON customization_audit_logs(order_item_id)', 'SELECT "idx_customization_audit_logs_order_item_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customization_audit_logs' AND index_name = 'idx_customization_audit_logs_vendor_id');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_customization_audit_logs_vendor_id ON customization_audit_logs(vendor_id)', 'SELECT "idx_customization_audit_logs_vendor_id already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customization_audit_logs' AND index_name = 'idx_customization_audit_logs_created_at');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_customization_audit_logs_created_at ON customization_audit_logs(created_at)', 'SELECT "idx_customization_audit_logs_created_at already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'uploaded_media' AND index_name = 'idx_uploaded_media_group');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_uploaded_media_group ON uploaded_media(media_group)', 'SELECT "idx_uploaded_media_group already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'uploaded_media' AND index_name = 'idx_uploaded_media_file_name');
SET @sql = IF(@index_exists = 0, 'CREATE INDEX idx_uploaded_media_file_name ON uploaded_media(file_name)', 'SELECT "idx_uploaded_media_file_name already exists" AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
