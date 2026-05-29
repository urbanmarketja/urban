INSERT INTO subscription_plans (code, name, monthly_price_jmd, product_limit, features, is_active)
VALUES
  ('starter', 'Starter vendor', 2500, 25, JSON_ARRAY('Private setup', 'Store dashboard', 'QR share tools'), TRUE),
  ('growth', 'Growth vendor', 6500, 150, JSON_ARRAY('Public storefront', 'Marketplace listings', 'Service bookings', 'Job posting tools'), TRUE),
  ('pro', 'Pro vendor', 12500, 500, JSON_ARRAY('Public storefront', 'Featured placement', 'Priority support', 'Advanced analytics'), TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  monthly_price_jmd = VALUES(monthly_price_jmd),
  product_limit = VALUES(product_limit),
  features = VALUES(features),
  is_active = VALUES(is_active);
