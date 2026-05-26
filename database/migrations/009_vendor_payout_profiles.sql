CREATE TABLE IF NOT EXISTS vendor_payout_profiles (
  vendor_id CHAR(36) PRIMARY KEY,
  payout_method VARCHAR(80) NOT NULL DEFAULT 'bank_transfer',
  payout_details TEXT,
  updated_by_user_id CHAR(36),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendor_payout_profiles_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_payout_profiles_user FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_vendor_payout_profiles_updated_by
  ON vendor_payout_profiles(updated_by_user_id);
