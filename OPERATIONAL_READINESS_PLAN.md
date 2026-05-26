# Urban Market JA Operational Readiness Plan

This plan finishes the site for real operation using the MySQL schema in `database/schema.sql`.

## Database Confirmation

The current schema supports the site requirements:

- Platform customers are stored in `users` plus `customer_profiles`.
- Customers are not tied to vendors.
- Vendors are stored separately in `vendors`.
- Vendor staff/owners are linked through `vendor_users`.
- Stores are managed through `stores`.
- Admin accounts are platform users with `admin_profiles`.
- Products and foods are handled by `products` using `type = product` or `type = food`.
- Product and store media are handled by `product_images` and `store_media`.
- Services and bookings are handled by `services` and `service_bookings`.
- Cart and checkout are handled by `carts`, `cart_items`, `orders`, and `order_items`.
- Jobs and applications are handled by `jobs` and `job_applications`.
- Vendor subscriptions are handled by `subscription_plans`, `vendor_subscriptions`, `payment_sessions`, and `payment_events`.
- One-year unregistered vendor rules are supported by `vendors.onboarded_at` and generated `unregistered_expires_at`.
- Registration assistance is handled by `registration_assistance_requests` and `vendor_documents`.
- Admin compliance and review workflows are supported by `compliance_alerts`, `notifications`, and `admin_audit_logs`.

## Phase 1 - MySQL Connection

- Install `mysql2` in `Backend`.
- Create the MySQL database.
- Configure `Backend/.env`.
- Run `npm run db:migrate`.
- Run `npm run db:seed`.
- Verify `/api/health` reports `dataMode: mysql`.

Acceptance check:

- Backend starts with `USE_DATABASE=true`.
- Schema creates successfully.
- Seed plans and users are available.

## Phase 2 - Repository Layer

Completed:

- Added the first MySQL repository module for public/admin read routes.
- Seed data now creates vendors, stores, products, services, and jobs in MySQL.
- Public read endpoints can now read from MySQL when `USE_DATABASE=true`.
- Write endpoints now use repository functions when `USE_DATABASE=true`.
- MySQL-backed routes now cover auth/signup, orders, bookings, applications, product publishing, subscription sessions, and registration assistance.
- Current in-memory arrays remain only as fallback behavior when `USE_DATABASE=false`.

Acceptance check:

- Existing API routes return data from MySQL.
- No marketplace data is stored only in memory.

## Phase 3 - Authentication And Roles

Completed:

- Added PBKDF2 password hashing with configurable pepper and seeded dev password support.
- Added signed bearer tokens for login/signup sessions.
- Enforced role checks on customer, vendor, and admin API routes.
- Added vendor ownership checks before vendor subscription, product, job, and registration-assistance actions.
- Added admin audit logging for privileged payment-session actions.
- Updated frontend login/signup and protected workflow calls to send bearer tokens.

Acceptance check:

- Customer cannot access vendor/admin data.
- Vendor can access only their stores, products, orders, bookings, jobs, and applicants.
- Admin can manage platform-wide records.

## Phase 4 - Vendor Operations

Completed:

- Added vendor operations API for store profile, products, foods, services, job posts, media, documents, and registration requests.
- Enforced vendor ownership on store/listing/service/job/media/document operations.
- Enforced subscription and registration compliance before publishing products and services.
- Added URL-based upload records for store media, product images, and registration documents.
- Added admin review actions for registration assistance requests and vendor documents.
- Added admin audit logging for document reviews and registration assistance updates.
- Expanded vendor and admin dashboards with controls for the new workflows.

Acceptance check:

- Vendor can manage their own store.
- Vendor cannot publish when subscription or compliance rules fail.
- Admin can review registration documents and assistance requests.

## Phase 5 - Customer Operations

Completed:

- Added MySQL-backed customer cart endpoints and local-first frontend cart syncing.
- Updated checkout to create orders from the signed-in customer's active MySQL cart and persist checkout addresses.
- Added customer address management endpoints and dashboard controls.
- Added customer dashboard data from database records for orders, bookings, applications, addresses, reviews, and cart.
- Added review submission tied to customer orders/bookings.

Acceptance check:

- Customer can order from multiple vendors in one order.
- Vendors see only their own order items.
- Customer remains a platform-level customer.

## Phase 6 - Payments And Subscriptions

Completed:

- Added configurable payment provider boundary using `PAYMENT_PROVIDER`.
- Replaced direct mock paid updates with pending provider checkout sessions.
- Added signed payment webhook endpoint at `/api/payments/webhooks/:provider`.
- Stored payment webhook payloads in `payment_events`.
- Updated `vendor_subscriptions` only from verified paid webhook events.
- Added admin visibility for payment webhook events.

Acceptance check:

- Vendor subscription status changes only after verified payment events.
- Past-due vendors are prevented from publishing.

## Phase 7 - Compliance Automation

Completed:

- Added compliance automation runner for registration and subscription alerts.
- Added startup and interval scheduling controlled by `COMPLIANCE_AUTOMATION_ENABLED` and `COMPLIANCE_AUTOMATION_INTERVAL_MINUTES`.
- Added admin-triggered compliance run endpoint.
- Generated registration alerts at 90, 30, and 7 days before expiry, plus critical alerts after expiry.
- Marked expired unregistered vendors as `expired`, keeping publishing blocked by the existing compliance gate.
- Added in-app vendor notifications for registration and subscription reminders.
- Updated admin and vendor dashboards to show compliance alerts and reminders.

Acceptance check:

- Admin dashboard shows compliance alerts.
- Vendors receive registration reminders.
- Expired unregistered vendors are blocked from selling.

## Phase 8 - Production Hardening

Completed:

- Added request validation for key write paths.
- Added basic per-IP/per-route API rate limiting.
- Added structured JSON logging to console and `Backend/logs/backend.log`.
- Added unhandled exception and rejection logging.
- Added MySQL backup and restore scripts.
- Added smoke test script for auth, checkout, vendor publishing, subscriptions, payment webhook, admin moderation, and compliance.
- Added deployment and production hardening documentation.

Acceptance check:

- Build passes.
- Backend check passes.
- Auth, checkout, vendor publishing, subscription, admin moderation, and compliance flows are tested.
- Database backup/restore is documented.

## Launch Minimum

The minimum operational launch should include:

- MySQL-backed auth.
- Admin account.
- Customer accounts.
- Vendor accounts and stores.
- Products/foods/services from database.
- Cart and checkout from database.
- Vendor subscription compliance gate.
- Admin compliance dashboard.
- Registration assistance request flow.

## Post-Phase Store Platform Updates

Completed:

- Public header now stays buyer-focused: Home, Market, Jobs, Cart, and role-aware Sign in/Dashboard access.
- Profile, Store, Dashboards, Services, Foods, and direct Checkout links are no longer exposed as public header items.
- Anonymous customers can add items to cart locally before signing in.
- Checkout redirects unsigned customers to sign in/sign up, then returns them to the cart with their items intact.
- Signed-in customer carts sync to the account cart from the cart page.
- Sign-in now uses backend authentication only; it no longer creates fake local users when the API is unavailable.
- Private areas are route guarded by role: customer dashboard/checkout, vendor dashboard/job posting, and admin.
- Signed-in users now get a sign-out control in the header.
- Vendor dashboard now loads the signed-in vendor's database operations instead of the static planning/demo vendor list.
- Products now include `stock_quantity` for vendor-managed inventory.
- Confirmed orders reduce product stock when enough stock is available.
- Vendor operations now include signed-in customer cart visibility.
- Vendors can create store, product, or customer-scoped discounts.

Next operational work:

- Apply the updated schema with `npm run db:migrate`, then rerun seed data if you want the demo products to receive starter stock quantities.
- Connect discount calculation into cart totals and checkout totals.
- Move order creation and stock reduction into a single MySQL transaction before launch.
- Add vendor-facing edit controls for existing product stock and existing discount status.
