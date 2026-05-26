# Repository Layer Plan

The current `server.js` still uses in-memory arrays so the app remains runnable without a database.

When MySQL is enabled, move route logic into repository modules with this shape:

- `users.repository.js`: users, customer profiles, admin profiles, vendor users.
- `vendors.repository.js`: vendors, stores, registration status, compliance.
- `catalog.repository.js`: products, foods, services.
- `orders.repository.js`: orders and order items.
- `bookings.repository.js`: service bookings.
- `jobs.repository.js`: jobs and applications.
- `subscriptions.repository.js`: plans, vendor subscriptions, payment sessions, payment events.

Important ownership rule:

- Customers are queried by platform `users.id`.
- Vendors never own customer rows.
- Vendor dashboards should query vendor-scoped records through `order_items.vendor_id`, `service_bookings.vendor_id`, and `jobs.vendor_id`.
- Admin dashboards can query across all vendors and customers.
