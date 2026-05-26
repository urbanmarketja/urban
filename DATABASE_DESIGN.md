# Urban Market JA Database Design

This design treats Urban Market JA as the platform owner. Customers belong to the platform, not to individual vendors. Vendors manage stores, products, services, jobs, and subscription/compliance records. Admin users manage the platform globally.

## Recommended Database

Use MySQL for the first production version.

Reasons:

- Strong relational integrity for orders, vendors, stores, subscriptions, and compliance.
- JSON support for payment provider payloads and flexible metadata.
- Mature indexing, migrations, backups, and reporting.
- Easy path to hosted providers such as AWS RDS, DigitalOcean Managed MySQL, PlanetScale-style MySQL platforms, Railway, or a VPS-hosted MySQL server.

## Core Identity Model

### users

Every login account is a platform user.

Roles:

- `customer`: shops, books services, applies for jobs.
- `vendor`: manages one or more vendor stores.
- `admin`: manages the full marketplace.

Customers are linked to `users` through `customer_profiles`.
Vendors are linked to `users` through `vendor_users`.
Admins are linked to `users` through `admin_profiles`.

This avoids tying a customer to a specific vendor. A customer can order from many vendors, book many services, and apply to many jobs while staying one platform-level customer.

## Marketplace Ownership

### vendors

Represents a vendor business account.

Important fields:

- business name
- registration status
- onboarded date
- unregistered expiry date
- compliance status
- subscription status

### stores

Represents the public storefront customers browse.

A vendor may eventually have more than one store, but the first version can use one store per vendor.

### vendor_users

Links platform users to vendors.

This supports:

- owner
- manager
- staff

No customer data belongs here.

## Customer Model

### customer_profiles

Holds customer-specific platform profile fields.

A customer profile can place orders with any vendor. Vendor-specific customer tables should be avoided unless later needed for private vendor notes, loyalty programs, or disputes.

## Admin Model

### admin_profiles

Links platform admin accounts to admin metadata.

Admins can:

- approve vendors
- review registration assistance requests
- moderate jobs
- view compliance alerts
- manage subscriptions
- manage customer support cases

Use role-based permissions rather than hard-coding one owner account forever.

## Products, Foods, and Services

### products

Products belong to a store.

Food can be modeled as products with `type = food`, or separated later if food ordering needs kitchen-specific workflows. For this project, use one `products` table with product types:

- `product`
- `food`

Inventory is tracked on `products.stock_quantity`. Vendors update this value from their dashboard, and confirmed orders reduce it before fulfillment continues.

### services

Services belong to a vendor or store and can be booked by platform customers.

## Orders

### orders

Orders belong to the platform customer, not to a vendor.

An order can contain items from multiple vendors.

### order_items

Each item points to:

- order
- product
- vendor
- store

This is how vendors see their own slice of an order without owning the customer account.

Active signed-in customer carts are stored in `carts` and `cart_items`. Vendors can see cart interest for their own products, but customers remain platform customers and are not assigned to that vendor.

## Discounts

### discounts

Discounts belong to vendors and can target:

- a full store
- specified products
- a specified platform customer

### discount_products

Links product-scoped discounts to the eligible products.

## Service Bookings

### service_bookings

Bookings belong to the customer and the service vendor.

Again, the customer is still platform-owned. The vendor only sees booking data needed to fulfill that service.

## Jobs

### jobs

Jobs are posted by vendors or admins.

### job_applications

Applications belong to a platform customer/user and a job.

Vendors see applications for jobs they posted, but the applicant remains a platform user.

## Subscriptions and Payments

### subscription_plans

Defines available vendor plans.

### vendor_subscriptions

Tracks each vendor subscription.

### payment_sessions

Stores checkout session attempts.

### payment_events

Stores webhook events from the payment provider.

The app should trust `payment_events` and subscription status updated from verified webhooks, not frontend redirects.

## Compliance

### compliance_alerts

Stores generated compliance alerts such as:

- unregistered vendor 90-day reminder
- unregistered vendor 30-day reminder
- unregistered vendor 7-day reminder
- registration expired
- subscription past due

### registration_assistance_requests

Tracks vendors asking for help registering their business.

Admins manage these records.

## Permissions Rule Summary

- Customers belong to the platform only.
- Vendors own stores, products, services, and jobs.
- Vendors can view only order items/bookings/applications connected to their vendor/store.
- Vendors can view active cart interest only for their own products.
- Vendors can create discounts only for their own store/products/customers.
- Admins can view and manage all platform data.
- Product publishing requires active subscription and valid registration eligibility.
- Unregistered vendors can sell for one year from onboarding.

## Migration Order

1. Create identity and role tables.
2. Create vendor/store/customer/admin tables.
3. Create products/services/jobs.
4. Create orders/bookings/applications.
5. Create subscriptions/payments.
6. Create compliance and admin review tables.
7. Replace in-memory arrays in `Backend/server.js` with repository functions.
8. Add auth middleware and role checks.
