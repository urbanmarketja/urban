CREATE TABLE IF NOT EXISTS discount_cart_offers (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  discount_id CHAR(36) NOT NULL,
  cart_id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  status ENUM('active', 'used', 'cancelled', 'expired') NOT NULL DEFAULT 'active',
  offered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  UNIQUE KEY uq_discount_cart_offers_discount_cart_vendor (discount_id, cart_id, vendor_id),
  CONSTRAINT fk_discount_cart_offers_discount FOREIGN KEY (discount_id) REFERENCES discounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_discount_cart_offers_cart FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
  CONSTRAINT fk_discount_cart_offers_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
