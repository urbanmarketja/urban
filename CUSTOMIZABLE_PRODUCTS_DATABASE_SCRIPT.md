# Customizable Products Database Script

All customization phases are now represented in:

- `database/migrations/015_product_customizations.sql`
- `Backend/db/migrations/015_product_customizations.sql`

Run the full migration once when you are ready to update the online database.

If you already ran the Phase 1-9 customization migration before Phase 10, run this additional Phase 10 audit-table SQL:

```sql
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

CREATE INDEX idx_customization_audit_logs_order_id ON customization_audit_logs(order_id);
CREATE INDEX idx_customization_audit_logs_order_item_id ON customization_audit_logs(order_item_id);
CREATE INDEX idx_customization_audit_logs_vendor_id ON customization_audit_logs(vendor_id);
CREATE INDEX idx_customization_audit_logs_created_at ON customization_audit_logs(created_at);
```

Only use the incremental SQL above if the rest of the customization tables already exist.
