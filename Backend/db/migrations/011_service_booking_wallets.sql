ALTER TABLE service_bookings
  MODIFY status ENUM('requested', 'confirmed', 'in_progress', 'completed', 'customer_confirmed', 'disputed', 'cancelled') NOT NULL DEFAULT 'requested';

ALTER TABLE service_bookings
  ADD COLUMN payment_status ENUM('created', 'pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending' AFTER status;

ALTER TABLE service_bookings
  ADD COLUMN vendor_completed_at TIMESTAMP NULL AFTER total_jmd;

ALTER TABLE service_bookings
  ADD COLUMN customer_confirmed_at TIMESTAMP NULL AFTER vendor_completed_at;

ALTER TABLE service_bookings
  ADD COLUMN funds_released_at TIMESTAMP NULL AFTER customer_confirmed_at;

ALTER TABLE service_bookings
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

CREATE TABLE IF NOT EXISTS service_booking_disputes (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  service_booking_id CHAR(36) NOT NULL,
  customer_user_id CHAR(36),
  vendor_id CHAR(36),
  created_by_user_id CHAR(36),
  reason VARCHAR(120) NOT NULL DEFAULT 'customer_reported_issue',
  status ENUM('open', 'under_review', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_service_booking_disputes_booking FOREIGN KEY (service_booking_id) REFERENCES service_bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_service_booking_disputes_customer FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_service_booking_disputes_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
  CONSTRAINT fk_service_booking_disputes_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payment_sessions
  ADD COLUMN service_booking_id CHAR(36) NULL AFTER order_id;

ALTER TABLE payment_sessions
  ADD CONSTRAINT fk_payment_sessions_service_booking FOREIGN KEY (service_booking_id) REFERENCES service_bookings(id) ON DELETE SET NULL;

ALTER TABLE vendor_wallet_ledger
  ADD COLUMN service_booking_id CHAR(36) NULL AFTER order_item_id;

ALTER TABLE vendor_wallet_ledger
  ADD CONSTRAINT fk_vendor_wallet_ledger_service_booking FOREIGN KEY (service_booking_id) REFERENCES service_bookings(id) ON DELETE SET NULL;

CREATE INDEX idx_payment_sessions_service_booking_id ON payment_sessions(service_booking_id);
CREATE UNIQUE INDEX uq_vendor_wallet_ledger_service_once ON vendor_wallet_ledger(service_booking_id, entry_type, balance_bucket, direction);
CREATE INDEX idx_service_booking_disputes_booking_id ON service_booking_disputes(service_booking_id);
CREATE INDEX idx_service_booking_disputes_status ON service_booking_disputes(status);
