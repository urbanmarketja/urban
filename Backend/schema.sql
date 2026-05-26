-- Urban Market JA MySQL schema starter
-- Customers are platform-level accounts. They are not owned by vendors.

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  role ENUM('customer', 'vendor', 'admin') NOT NULL,
  status ENUM('active', 'disabled', 'pending') NOT NULL DEFAULT 'active',
  full_name VARCHAR(180) NOT NULL,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(40) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT users_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_profiles (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL UNIQUE,
  parish VARCHAR(120),
  default_delivery_address TEXT,
  preferences JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customer_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  customer_user_id CHAR(36) NOT NULL,
  label VARCHAR(80) NOT NULL DEFAULT 'Default',
  recipient_name VARCHAR(180),
  phone VARCHAR(40),
  address_line_1 VARCHAR(255) NOT NULL,
  address_line_2 VARCHAR(255),
  parish VARCHAR(120),
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  notes TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customer_addresses_user FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_profiles (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL UNIQUE,
  title VARCHAR(160),
  permissions JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendors (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  business_name VARCHAR(180) NOT NULL,
  legal_name VARCHAR(180),
  trn VARCHAR(80),
  registration_number VARCHAR(120),
  store_type VARCHAR(40) NOT NULL DEFAULT 'products',
  registration_status ENUM('registered', 'unregistered', 'expired') NOT NULL DEFAULT 'unregistered',
  onboarded_at DATE NOT NULL DEFAULT (CURRENT_DATE),
  unregistered_expires_at DATE GENERATED ALWAYS AS (DATE_ADD(onboarded_at, INTERVAL 1 YEAR)) STORED,
  status ENUM('active', 'disabled', 'pending') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_users (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  vendor_role VARCHAR(60) NOT NULL DEFAULT 'owner',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vendor_users_vendor_user (vendor_id, user_id),
  CONSTRAINT fk_vendor_users_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_users_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stores (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  summary TEXT,
  location VARCHAR(180),
  address_line_1 VARCHAR(255),
  address_line_2 VARCHAR(255),
  parish VARCHAR(120),
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  status ENUM('draft', 'active', 'paused', 'suspended') NOT NULL DEFAULT 'draft',
  rating DECIMAL(3, 2) NOT NULL DEFAULT 0,
  share_token VARCHAR(64) NOT NULL DEFAULT (REPLACE(UUID(), '-', '')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stores_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_media (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  store_id CHAR(36) NOT NULL,
  media_type ENUM('logo', 'banner', 'gallery') NOT NULL,
  url TEXT NOT NULL,
  alt_text VARCHAR(220),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_store_media_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  monthly_price_jmd INT NOT NULL CHECK (monthly_price_jmd >= 0),
  product_limit INT NOT NULL CHECK (product_limit > 0),
  features JSON,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_subscriptions (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  status ENUM('trial', 'active', 'past_due', 'cancelled') NOT NULL DEFAULT 'trial',
  current_period_start DATE,
  current_period_end DATE,
  last_payment_at TIMESTAMP NULL,
  provider_customer_id VARCHAR(255),
  provider_subscription_id VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendor_subscriptions_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  store_id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  type ENUM('product', 'food') NOT NULL DEFAULT 'product',
  name VARCHAR(220) NOT NULL,
  description TEXT,
  price_jmd INT NOT NULL CHECK (price_jmd >= 0),
  stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  delivery_day VARCHAR(40),
  status ENUM('draft', 'published', 'paused', 'rejected') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_products_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_images (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  product_id CHAR(36) NOT NULL,
  url TEXT NOT NULL,
  alt_text VARCHAR(220),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS services (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  store_id CHAR(36),
  name VARCHAR(220) NOT NULL,
  category VARCHAR(120) NOT NULL,
  description TEXT,
  details TEXT,
  price_jmd INT NOT NULL CHECK (price_jmd >= 0),
  pricing_type VARCHAR(60) NOT NULL DEFAULT 'Fixed',
  status ENUM('draft', 'published', 'paused', 'rejected') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_services_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_services_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carts (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  customer_user_id CHAR(36) NOT NULL,
  status ENUM('active', 'converted', 'abandoned') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_carts_customer_user FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cart_items (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  cart_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  store_id CHAR(36) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price_jmd INT NOT NULL CHECK (unit_price_jmd >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cart_items_cart_product (cart_id, product_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_cart_items_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  CONSTRAINT fk_cart_items_store FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  customer_user_id CHAR(36) NOT NULL,
  status ENUM('pending', 'confirmed', 'paid', 'fulfilling', 'completed', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending',
  payment_status ENUM('created', 'pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'created',
  payment_method VARCHAR(80),
  subtotal_jmd INT NOT NULL DEFAULT 0,
  delivery_fee_jmd INT NOT NULL DEFAULT 0,
  total_jmd INT NOT NULL DEFAULT 0,
  delivery_address TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_customer_user FOREIGN KEY (customer_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  order_id CHAR(36) NOT NULL,
  product_id CHAR(36),
  vendor_id CHAR(36) NOT NULL,
  store_id CHAR(36) NOT NULL,
  item_name VARCHAR(220) NOT NULL,
  unit_price_jmd INT NOT NULL CHECK (unit_price_jmd >= 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  line_total_jmd INT NOT NULL CHECK (line_total_jmd >= 0),
  fulfillment_status VARCHAR(80) NOT NULL DEFAULT 'pending',
  vendor_completed_at TIMESTAMP NULL,
  customer_received_at TIMESTAMP NULL,
  funds_released_at TIMESTAMP NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_items_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  CONSTRAINT fk_order_items_store FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  service_booking_id CHAR(36),
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

CREATE TABLE IF NOT EXISTS discounts (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  store_id CHAR(36),
  customer_user_id CHAR(36),
  code VARCHAR(80),
  name VARCHAR(180) NOT NULL,
  discount_type ENUM('percent', 'fixed') NOT NULL,
  amount INT NOT NULL CHECK (amount > 0),
  scope ENUM('store', 'product', 'customer') NOT NULL DEFAULT 'store',
  starts_at TIMESTAMP NULL,
  ends_at TIMESTAMP NULL,
  status ENUM('active', 'paused', 'expired') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_discounts_vendor_code (vendor_id, code),
  CONSTRAINT fk_discounts_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_discounts_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_discounts_customer FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS discount_products (
  discount_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  PRIMARY KEY (discount_id, product_id),
  CONSTRAINT fk_discount_products_discount FOREIGN KEY (discount_id) REFERENCES discounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_discount_products_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_bookings (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  customer_user_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  status ENUM('requested', 'confirmed', 'in_progress', 'completed', 'customer_confirmed', 'disputed', 'cancelled') NOT NULL DEFAULT 'requested',
  payment_status ENUM('created', 'pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  location TEXT NOT NULL,
  notes TEXT,
  total_jmd INT NOT NULL DEFAULT 0,
  vendor_completed_at TIMESTAMP NULL,
  customer_confirmed_at TIMESTAMP NULL,
  funds_released_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_service_bookings_customer_user FOREIGN KEY (customer_user_id) REFERENCES users(id),
  CONSTRAINT fk_service_bookings_service FOREIGN KEY (service_id) REFERENCES services(id),
  CONSTRAINT fk_service_bookings_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS reviews (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  customer_user_id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  store_id CHAR(36),
  product_id CHAR(36),
  service_id CHAR(36),
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  status ENUM('pending', 'published', 'hidden') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_customer_user FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL,
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_reviews_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36),
  posted_by_user_id CHAR(36) NOT NULL,
  title VARCHAR(220) NOT NULL,
  employer_name VARCHAR(180) NOT NULL,
  category VARCHAR(120) NOT NULL,
  location VARCHAR(180) NOT NULL,
  salary_jmd INT NOT NULL DEFAULT 0,
  job_type VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  responsibilities JSON,
  requirements JSON,
  contact VARCHAR(255) NOT NULL,
  status ENUM('draft', 'pending_approval', 'published', 'closed', 'rejected') NOT NULL DEFAULT 'pending_approval',
  deadline DATE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_jobs_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
  CONSTRAINT fk_jobs_posted_by_user FOREIGN KEY (posted_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_applications (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  job_id CHAR(36) NOT NULL,
  applicant_user_id CHAR(36) NOT NULL,
  applicant_name VARCHAR(180) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  resume_url TEXT,
  message TEXT,
  status ENUM('pending', 'reviewed', 'shortlisted', 'rejected', 'hired') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_job_applications_job_applicant (job_id, applicant_user_id),
  CONSTRAINT fk_job_applications_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_job_applications_applicant_user FOREIGN KEY (applicant_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_sessions (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36),
  order_id CHAR(36),
  service_booking_id CHAR(36),
  plan_id CHAR(36),
  provider VARCHAR(80) NOT NULL,
  provider_session_id VARCHAR(255),
  status ENUM('created', 'pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'created',
  amount_jmd INT NOT NULL CHECK (amount_jmd >= 0),
  checkout_url TEXT,
  metadata JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  CONSTRAINT fk_payment_sessions_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
  CONSTRAINT fk_payment_sessions_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_payment_sessions_service_booking FOREIGN KEY (service_booking_id) REFERENCES service_bookings(id) ON DELETE SET NULL,
  CONSTRAINT fk_payment_sessions_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_events (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  provider VARCHAR(80) NOT NULL,
  provider_event_id VARCHAR(255) NOT NULL UNIQUE,
  event_type VARCHAR(160) NOT NULL,
  payload JSON NOT NULL,
  processed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compliance_alerts (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  severity ENUM('ok', 'notice', 'warning', 'critical') NOT NULL,
  alert_type VARCHAR(120) NOT NULL,
  message TEXT NOT NULL,
  due_date DATE,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_compliance_alerts_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registration_assistance_requests (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  requested_by_user_id CHAR(36),
  status ENUM('requested', 'in_review', 'waiting_on_vendor', 'completed', 'cancelled') NOT NULL DEFAULT 'requested',
  notes TEXT,
  assigned_admin_user_id CHAR(36),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_registration_requests_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_registration_requests_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_registration_requests_admin FOREIGN KEY (assigned_admin_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_documents (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  uploaded_by_user_id CHAR(36),
  document_type VARCHAR(120) NOT NULL,
  file_url TEXT NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  reviewed_by_admin_user_id CHAR(36),
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendor_documents_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_documents_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_vendor_documents_reviewed_by FOREIGN KEY (reviewed_by_admin_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id CHAR(36),
  vendor_id CHAR(36),
  channel ENUM('in_app', 'email', 'sms') NOT NULL DEFAULT 'in_app',
  notification_type VARCHAR(120) NOT NULL,
  title VARCHAR(220) NOT NULL,
  message TEXT NOT NULL,
  scheduled_for TIMESTAMP NULL,
  sent_at TIMESTAMP NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  admin_user_id CHAR(36),
  action VARCHAR(160) NOT NULL,
  entity_type VARCHAR(120) NOT NULL,
  entity_id CHAR(36),
  details JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_audit_logs_admin_user FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_vendor_users_user_id ON vendor_users(user_id);
CREATE INDEX idx_stores_vendor_id ON stores(vendor_id);
CREATE INDEX idx_store_media_store_id ON store_media(store_id);
CREATE INDEX idx_products_store_id ON products(store_id);
CREATE INDEX idx_products_vendor_id ON products(vendor_id);
CREATE INDEX idx_products_stock_quantity ON products(stock_quantity);
CREATE INDEX idx_product_images_product_id ON product_images(product_id);
CREATE INDEX idx_carts_customer_user_id ON carts(customer_user_id);
CREATE INDEX idx_orders_customer_user_id ON orders(customer_user_id);
CREATE INDEX idx_order_disputes_order_id ON order_disputes(order_id);
CREATE INDEX idx_order_disputes_status ON order_disputes(status);
CREATE INDEX idx_payment_sessions_order_id ON payment_sessions(order_id);
CREATE INDEX idx_payment_sessions_service_booking_id ON payment_sessions(service_booking_id);
CREATE INDEX idx_payment_sessions_status ON payment_sessions(status);
CREATE INDEX idx_order_items_vendor_id ON order_items(vendor_id);
CREATE INDEX idx_order_items_order_vendor ON order_items(order_id, vendor_id);
CREATE INDEX idx_vendor_wallet_ledger_vendor_id ON vendor_wallet_ledger(vendor_id);
CREATE UNIQUE INDEX uq_vendor_wallet_ledger_once ON vendor_wallet_ledger(order_item_id, entry_type, balance_bucket, direction);
CREATE UNIQUE INDEX uq_vendor_wallet_ledger_service_once ON vendor_wallet_ledger(service_booking_id, entry_type, balance_bucket, direction);
CREATE INDEX idx_vendor_checkout_requests_vendor_id ON vendor_checkout_requests(vendor_id);
CREATE INDEX idx_vendor_payout_profiles_updated_by ON vendor_payout_profiles(updated_by_user_id);
CREATE INDEX idx_product_features_product_id ON product_features(product_id);
CREATE INDEX idx_discounts_vendor_id ON discounts(vendor_id);
CREATE INDEX idx_discounts_customer_user_id ON discounts(customer_user_id);
CREATE INDEX idx_service_bookings_customer_user_id ON service_bookings(customer_user_id);
CREATE INDEX idx_service_bookings_vendor_id ON service_bookings(vendor_id);
CREATE INDEX idx_service_booking_disputes_booking_id ON service_booking_disputes(service_booking_id);
CREATE INDEX idx_service_booking_disputes_status ON service_booking_disputes(status);
CREATE INDEX idx_reviews_vendor_id ON reviews(vendor_id);
CREATE INDEX idx_jobs_vendor_id ON jobs(vendor_id);
CREATE INDEX idx_job_applications_applicant_user_id ON job_applications(applicant_user_id);
CREATE INDEX idx_compliance_alerts_vendor_id ON compliance_alerts(vendor_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_admin_audit_logs_admin_user_id ON admin_audit_logs(admin_user_id);
