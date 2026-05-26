ALTER TABLE admin_audit_logs MODIFY admin_user_id CHAR(36) NULL;

CREATE UNIQUE INDEX uq_vendor_wallet_ledger_once
  ON vendor_wallet_ledger(order_item_id, entry_type, balance_bucket, direction);
