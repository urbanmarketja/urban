-- Development seed data for Urban Market JA.
-- Run after schema.sql when a MySQL database is configured.

INSERT INTO subscription_plans (code, name, monthly_price_jmd, product_limit, features)
VALUES
  ('starter', 'Starter vendor', 2500, 25, JSON_ARRAY('Storefront', 'QR share tools', 'Basic order dashboard')),
  ('growth', 'Growth vendor', 6500, 150, JSON_ARRAY('Featured placement', 'Service bookings', 'Job posting tools')),
  ('pro', 'Pro vendor', 12500, 500, JSON_ARRAY('Priority support', 'Advanced analytics', 'Campaign support'))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  monthly_price_jmd = VALUES(monthly_price_jmd),
  product_limit = VALUES(product_limit),
  features = VALUES(features);

-- Password hashes below are placeholders. Replace before using this seed outside local development.
INSERT INTO users (role, full_name, email, phone, password_hash)
VALUES
  ('admin', 'Platform Owner', 'owner@urbanmarket.jm', NULL, 'dev-placeholder-hash'),
  ('customer', 'Urban Member', 'member@example.com', NULL, 'dev-placeholder-hash'),
  ('vendor', 'Island Eats Manager', 'vendor@urbanmarket.jm', NULL, 'dev-placeholder-hash'),
  ('vendor', 'Market Glow Manager', 'marketglow@urbanmarket.jm', NULL, 'dev-placeholder-hash'),
  ('vendor', 'Green Grove Manager', 'greengrove@urbanmarket.jm', NULL, 'dev-placeholder-hash')
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  role = VALUES(role);

INSERT IGNORE INTO vendors (id, business_name, legal_name, registration_status, onboarded_at, status)
VALUES
  ('v1', 'Island Eats', 'Island Eats JA', 'unregistered', '2026-02-01', 'active'),
  ('v2', 'Market Glow', 'Market Glow JA', 'registered', '2025-06-15', 'active'),
  ('v3', 'Green Grove', 'Green Grove Produce', 'registered', '2025-09-05', 'active');

INSERT IGNORE INTO vendor_users (vendor_id, user_id, vendor_role)
SELECT 'v1', id, 'owner' FROM users WHERE email = 'vendor@urbanmarket.jm';

INSERT IGNORE INTO vendor_users (vendor_id, user_id, vendor_role)
SELECT 'v2', id, 'owner' FROM users WHERE email = 'marketglow@urbanmarket.jm';

INSERT IGNORE INTO vendor_users (vendor_id, user_id, vendor_role)
SELECT 'v3', id, 'owner' FROM users WHERE email = 'greengrove@urbanmarket.jm';

INSERT IGNORE INTO stores (id, vendor_id, name, slug, summary, location, address_line_1, parish, latitude, longitude, status, rating)
VALUES
  ('s1', 'v1', 'Island Eats', 'island-eats', 'Jerk meals, patties, event trays, and catering support with scheduled delivery.', 'Half Way Tree', 'Half Way Tree', 'St. Andrew', 18.0125000, -76.7981000, 'active', 4.8),
  ('s2', 'v2', 'Market Glow', 'market-glow', 'Beauty, wellness, and daily market essentials from trusted local sellers.', 'Portmore', 'Portmore', 'St. Catherine', 17.9503000, -76.8827000, 'active', 4.7),
  ('s3', 'v3', 'Green Grove', 'green-grove', 'Fresh produce bundles, fruit crates, herbs, and pantry staples.', 'Spanish Town', 'Spanish Town', 'St. Catherine', 17.9911000, -76.9574000, 'active', 4.9);

UPDATE stores
SET address_line_1 = CASE id WHEN 's1' THEN 'Half Way Tree' WHEN 's2' THEN 'Portmore' WHEN 's3' THEN 'Spanish Town' ELSE address_line_1 END,
    parish = CASE id WHEN 's1' THEN 'St. Andrew' WHEN 's2' THEN 'St. Catherine' WHEN 's3' THEN 'St. Catherine' ELSE parish END,
    latitude = CASE id WHEN 's1' THEN 18.0125000 WHEN 's2' THEN 17.9503000 WHEN 's3' THEN 17.9911000 ELSE latitude END,
    longitude = CASE id WHEN 's1' THEN -76.7981000 WHEN 's2' THEN -76.8827000 WHEN 's3' THEN -76.9574000 ELSE longitude END
WHERE id IN ('s1', 's2', 's3');

INSERT IGNORE INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, last_payment_at)
SELECT 'v1', id, 'trial', '2026-04-01', '2026-05-01', NULL FROM subscription_plans WHERE code = 'starter';

INSERT IGNORE INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, last_payment_at)
SELECT 'v2', id, 'active', '2026-04-15', '2026-05-15', '2026-04-15 09:00:00' FROM subscription_plans WHERE code = 'growth';

INSERT IGNORE INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, last_payment_at)
SELECT 'v3', id, 'active', '2026-04-05', '2026-05-05', '2026-04-05 09:00:00' FROM subscription_plans WHERE code = 'growth';

INSERT IGNORE INTO products (id, store_id, vendor_id, type, name, description, price_jmd, stock_quantity, delivery_day, status)
VALUES
  ('p1', 's3', 'v3', 'product', 'Organic Callaloo Bundle', 'Fresh island greens with herbs and seasoning add-ons.', 2350, 80, 'Fri', 'published'),
  ('p2', 's1', 'v1', 'food', 'Jerk Chicken Family Pack', 'Family meal pack with sides, sauce, and pickup or delivery.', 4250, 35, 'Mon', 'published'),
  ('p3', 's3', 'v3', 'product', 'Fresh Pineapple Crate', 'Seasonal pineapple crate sourced from local growers.', 1650, 24, 'Fri', 'published'),
  ('p4', 's2', 'v2', 'product', 'Glow Essentials Kit', 'Beauty and wellness bundle for weekly self-care.', 3900, 42, 'Wed', 'published'),
  ('f1', 's1', 'v1', 'food', 'Spicy Jerk Chicken', 'Hot jerk chicken meal for families and events.', 2750, 30, 'Mon', 'published'),
  ('f2', 's1', 'v1', 'food', 'Patties & Sides', 'Assorted patty platter with drinks and snacks.', 1620, 45, 'Wed', 'published'),
  ('f3', 's3', 'v3', 'food', 'Fresh Fruit Crate', 'Seasonal fruits sourced from local growers.', 2100, 18, 'Fri', 'published'),
  ('f4', 's1', 'v1', 'food', 'Island Breakfast Box', 'Breakfast items with coffee, buns, and fresh juice.', 1980, 20, 'Fri', 'published')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  price_jmd = VALUES(price_jmd),
  stock_quantity = VALUES(stock_quantity);

INSERT IGNORE INTO services (id, vendor_id, store_id, name, category, description, details, price_jmd, pricing_type, status)
VALUES
  ('delivery-run', 'v1', 's1', 'Same-Day Delivery Run', 'Delivery Services', 'Send packages, groceries, or urgent items across the city with fast local delivery.', 'Includes up to 3 stops and live drop-off updates.', 1100, 'Fixed', 'published'),
  ('home-repairs', 'v2', 's2', 'Home Repairs & Maintenance', 'Home Services', 'Local technicians for plumbing, electrical, carpentry and small home repairs.', 'Technician arrives with basic tools and materials.', 2800, 'Hourly', 'published'),
  ('personal-care', 'v2', 's2', 'Personal Care & Grooming', 'Personal Services', 'Mobile beauty and grooming services for haircuts, manicures, and styling.', 'Good for busy days, events, or appointments at home.', 2000, 'Fixed', 'published'),
  ('errand-run', 'v1', 's1', 'Errands & Pickup Service', 'Errands / Pickup Services', 'Run errands, pick up groceries, or collect parcels from local stores and vendors.', 'Ideal for grocery pickups and merchant collections.', 950, 'Fixed', 'published');

INSERT IGNORE INTO jobs (id, vendor_id, posted_by_user_id, title, employer_name, category, location, salary_jmd, salary_min_jmd, salary_max_jmd, job_type, description, responsibilities, requirements, contact, status, deadline)
SELECT 'jm001', NULL, id, 'Marketplace Delivery Coordinator', 'Island Logistics', 'Delivery', 'Kingston', 2400, 2400, 3200, 'Full-time', 'Coordinate delivery teams, manage routes, and ensure on-time pickup for marketplace orders.', JSON_ARRAY('Plan delivery routes', 'Communicate with vendors and drivers', 'Track performance and delivery time'), JSON_ARRAY('Excellent communication skills', 'Experience with local logistics', 'Ability to work with scheduling tools'), 'jobs@islandlogistics.jm', 'published', '2026-05-05'
FROM users WHERE email = 'owner@urbanmarket.jm';

INSERT IGNORE INTO jobs (id, vendor_id, posted_by_user_id, title, employer_name, category, location, salary_jmd, salary_min_jmd, salary_max_jmd, job_type, description, responsibilities, requirements, contact, status, deadline)
SELECT 'jm002', 'v2', id, 'Freelance Website Builder', 'Market Glow', 'Digital Services', 'Remote', 1800, 1800, 3000, 'Contract', 'Build landing pages and e-commerce storefronts for local vendors using simple responsive design.', JSON_ARRAY('Develop websites', 'Collect vendor assets', 'Deploy finished pages'), JSON_ARRAY('Web development experience', 'Responsive design skills', 'Basic SEO knowledge'), 'talent@marketglow.jm', 'published', '2026-05-01'
FROM users WHERE email = 'owner@urbanmarket.jm';

INSERT IGNORE INTO jobs (id, vendor_id, posted_by_user_id, title, employer_name, category, location, salary_jmd, salary_min_jmd, salary_max_jmd, job_type, description, responsibilities, requirements, contact, status, deadline)
SELECT 'jm003', 'v1', id, 'Event Catering Assistant', 'Island Eats', 'Hospitality', 'Portmore', 1200, 1200, 1800, 'Part-time', 'Support catering events with food prep, delivery setup, and customer service during meals.', JSON_ARRAY('Prepare food packages', 'Assist at event sites', 'Communicate with customers and vendors'), JSON_ARRAY('Friendly customer service', 'Weekend availability', 'Food handling experience preferred'), 'careers@islandeats.jm', 'published', '2026-04-28'
FROM users WHERE email = 'vendor@urbanmarket.jm';

INSERT IGNORE INTO carts (id, customer_user_id, status)
SELECT 'cart-demo-member', id, 'active'
FROM users
WHERE email = 'member@example.com';

INSERT INTO cart_items (id, cart_id, product_id, vendor_id, store_id, quantity, unit_price_jmd)
VALUES
  ('cart-demo-p2', 'cart-demo-member', 'p2', 'v1', 's1', 1, 4250),
  ('cart-demo-p4', 'cart-demo-member', 'p4', 'v2', 's2', 1, 3900)
ON DUPLICATE KEY UPDATE
  quantity = VALUES(quantity),
  unit_price_jmd = VALUES(unit_price_jmd);

INSERT IGNORE INTO discounts (id, vendor_id, store_id, customer_user_id, code, name, discount_type, amount, scope, status)
VALUES
  ('discount-island-welcome', 'v1', 's1', NULL, 'ISLAND10', 'Island Eats welcome offer', 'percent', 10, 'store', 'active'),
  ('discount-glow-kit', 'v2', 's2', NULL, 'GLOW500', 'Glow Essentials special', 'fixed', 500, 'product', 'active');

INSERT IGNORE INTO discount_products (discount_id, product_id)
VALUES
  ('discount-glow-kit', 'p4');

INSERT IGNORE INTO vendor_documents (id, vendor_id, uploaded_by_user_id, document_type, file_url, status)
SELECT 'doc-v1-registration', 'v1', id, 'Business registration assistance intake', 'https://example.com/docs/island-eats-intake.pdf', 'pending'
FROM users
WHERE email = 'vendor@urbanmarket.jm';

INSERT IGNORE INTO notifications (id, user_id, vendor_id, notification_type, title, message)
SELECT 'note-v1-registration-window', id, 'v1', 'registration_window', 'Registration support available', 'Island Eats is inside the one-year unregistered vendor window. Request assistance from the vendor dashboard.'
FROM users
WHERE email = 'vendor@urbanmarket.jm';
