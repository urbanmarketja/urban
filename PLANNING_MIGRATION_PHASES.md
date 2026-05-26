# Urban Market JA Migration Phases

## Phase 1 - Functional marketplace foundation

Completed in this pass:

- Converted the static landing and marketplace concepts into Angular routes.
- Added vendor storefront pages with all products from a vendor.
- Added vendor share tools: QR code, copy link, WhatsApp share, and Facebook share.
- Added profile management UI with local save behavior.
- Added subscription and business-registration status to vendor dashboard.
- Added the one-year unregistered vendor window and registration assistance offer.
- Created a backend API scaffold with vendor, product, profile, eligibility, and registration-assistance routes.

## Phase 2 - Cart, checkout, and orders

Completed in this pass:

- Rebuilt `cart.html`, `checkout.html`, and `cart.js` as Angular routes backed by `CartService`.
- Replaced static DOM cart logic with typed cart state persisted to `localStorage`.
- Wired product cards and vendor store products to add items to the cart.
- Added checkout delivery details, Dime payment summary, order placement, cart clearing, and invoice download.
- Added backend order routes for order creation, listing, status lookup, and text invoice retrieval.

Still recommended:

- Add automated unit tests for cart totals, quantity changes, empty cart states, and checkout error handling.
- Persist orders in a database instead of in-memory backend arrays.

## Phase 3 - Services, foods, and jobs

Completed in this pass:

- Converted `services.html`, `service-detail.html`, `foods.html`, `jobs.html`, `job-detail.html`, and `post-job.html` into Angular routes.
- Moved service, food, and job seed data into typed frontend data models.
- Added service category filtering, service detail pages, service reviews, nearby services, and booking confirmation.
- Added food listing page linked back to vendor stores.
- Added job search/filtering, job detail pages, application submission, and job posting with draft/publish states.
- Added backend API routes for services, bookings, foods, jobs, and applications.

Still recommended:

- Persist service bookings, applications, and posted jobs in a database.
- Add vendor/employer ownership checks before editing jobs or viewing applicants.
- Add admin approval workflows for newly posted jobs.

## Phase 4 - Authentication and account roles

Completed in this pass:

- Converted `login.html`, `signup.html`, `dashboard-access.html`, `user-dashboard.html`, and `admin.html` into Angular routes.
- Added local account/session management for customer, vendor, and admin roles.
- Added role-directed login redirects for customer, vendor, and owner/admin users.
- Added vendor signup business fields.
- Added customer dashboard aggregation for product orders, service bookings, and job applications.
- Added admin dashboard overview, marketplace controls, and job moderation summary.
- Added backend mock auth/profile/user/dashboard routes to define the future API boundary.

Still recommended:

- Replace mock auth with password hashing, sessions or JWTs, and real middleware.
- Enforce role-based access on backend routes before returning admin, vendor, or customer data.
- Persist user profiles, sessions, and dashboard records in a database instead of memory/local storage.

## Phase 5 - Production subscriptions and compliance

Completed in this pass:

- Added subscription plan data and vendor payment status fields.
- Added vendor subscription plan selection and mock checkout session creation.
- Added backend subscription endpoints for plans, checkout sessions, and marking mock sessions paid.
- Enforced vendor subscription and registration eligibility before product publishing in `POST /api/products`.
- Added compliance severity/messages for active, trial, past-due, registered, unregistered, and expired vendor states.
- Added compliance alert surfaces to the vendor dashboard and admin dashboard.
- Added backend compliance endpoints for alerts and registration assistance requests.
- Registration assistance requests are now stored in a review queue on the backend.

Still recommended:

- Replace mock checkout sessions with a real payment provider webhook flow.
- Add scheduled jobs for 90, 30, and 7 day unregistered-vendor reminders.
- Store subscription, compliance, and registration assistance records in a database.
- Enforce admin/vendor authorization with real middleware before changing subscriptions or publishing products.
