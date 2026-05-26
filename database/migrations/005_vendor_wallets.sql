ALTER TABLE vendors
  ADD COLUMN store_type VARCHAR(40) NOT NULL DEFAULT 'products' AFTER registration_number;

ALTER TABLE order_items
  ADD COLUMN vendor_completed_at TIMESTAMP NULL AFTER fulfillment_status;

ALTER TABLE order_items
  ADD COLUMN customer_received_at TIMESTAMP NULL AFTER vendor_completed_at;

ALTER TABLE order_items
  ADD COLUMN funds_released_at TIMESTAMP NULL AFTER customer_received_at;

CREATE TABLE IF NOT EXISTS vendor_wallet_accounts (
  vendor_id CHAR(36) PRIMARY KEY,
  available_coins INT NOT NULL DEFAULT 0 CHECK (available_coins >= 0),
  held_coins INT NOT NULL DEFAULT 0 CHECK (held_coins >= 0),
  pending_checkout_coins INT NOT NULL DEFAULT 0 CHECK (pending_checkout_coins >= 0),
  lifetime_earned_coins INT NOT NULL DEFAULT 0 CHECK (lifetime_earned_coins >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendor_wallet_accounts_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_wallet_ledger (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  order_id CHAR(36),
  order_item_id CHAR(36),
  checkout_request_id CHAR(36),
  product_id CHAR(36),
  payment_session_id CHAR(36),
  entry_type VARCHAR(80) NOT NULL,
  balance_bucket ENUM('held', 'available', 'pending_checkout') NOT NULL,
  direction ENUM('credit', 'debit') NOT NULL,
  amount_coins INT NOT NULL CHECK (amount_coins > 0),
  amount_jmd INT NOT NULL CHECK (amount_jmd > 0),
  description VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendor_wallet_ledger_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_wallet_ledger_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_vendor_wallet_ledger_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_vendor_wallet_ledger_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_checkout_requests (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  requested_by_user_id CHAR(36),
  amount_coins INT NOT NULL CHECK (amount_coins > 0),
  amount_jmd INT NOT NULL CHECK (amount_jmd > 0),
  payout_method VARCHAR(80),
  payout_details TEXT,
  status ENUM('requested', 'approved', 'paid', 'cancelled', 'rejected') NOT NULL DEFAULT 'requested',
  advisory_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendor_checkout_requests_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_checkout_requests_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_features (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMP NOT NULL,
  cost_coins INT NOT NULL CHECK (cost_coins > 0),
  status ENUM('active', 'expired', 'cancelled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_features_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_features_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_order_items_order_vendor ON order_items(order_id, vendor_id);
CREATE INDEX idx_vendor_wallet_ledger_vendor_id ON vendor_wallet_ledger(vendor_id);
CREATE INDEX idx_vendor_checkout_requests_vendor_id ON vendor_checkout_requests(vendor_id);
CREATE INDEX idx_product_features_product_id ON product_features(product_id);

INSERT IGNORE INTO vendor_wallet_accounts (vendor_id)
SELECT id FROM vendors;
