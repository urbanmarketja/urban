CREATE TABLE IF NOT EXISTS order_disputes (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  order_id CHAR(36) NOT NULL,
  vendor_id CHAR(36),
  customer_user_id CHAR(36),
  created_by_user_id CHAR(36),
  reason VARCHAR(120) NOT NULL DEFAULT 'customer_reported_issue',
  status ENUM('open', 'under_review', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_disputes_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_disputes_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_disputes_customer FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_disputes_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_order_disputes_order_id ON order_disputes(order_id);
CREATE INDEX idx_order_disputes_status ON order_disputes(status);
