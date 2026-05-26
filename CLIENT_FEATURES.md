# Urban Market JA - Current Site Features

This document summarizes the features currently available in the Urban Market JA site in client-friendly terms. It focuses on what customers, vendors, admins, and the site owner can do, rather than how the code is built.

## At A Glance

Urban Market JA is set up as a multi-vendor online marketplace for products, foods, services, and jobs. Customers can browse and shop from multiple stores, vendors can manage their own storefronts and listings, and admins can manage platform activity, vendors, orders, jobs, subscriptions, and payout requests.

The site also includes a built-in digital money system called Market Credits, which tracks vendor earnings, holds funds until delivery is confirmed, and allows vendors to spend credits on subscriptions or platform features.

## Public Site And Marketplace

- Public home page with access to the main marketplace areas.
- Marketplace page for browsing products, foods, services, and vendor listings.
- Search bar for finding items in the marketplace.
- Marketplace filters for viewing all listings, products, foods, or services.
- Product and food listings show vendor details, pricing, delivery information, stock status, and discounts where available.
- Discounted items show a visual price change, including the original price and sale price.
- Products link back to the vendor's store so customers can view all goods from that vendor.
- Vendor store pages show the store profile, listings, business status, and sharing options.
- Vendor store pages include a map area, approximate distance estimate, and a directions button that opens the customer's device maps app.
- Only registered businesses are displayed publicly in the marketplace.
- Customers can add items to the cart before signing in.
- When checkout is selected, customers are directed to sign in or sign up, then returned to their cart.
- Checkout creates an internal payment session so order payment status can be tracked before vendor credits are released.

## Vendor Storefronts

- Each vendor can have a public store page.
- Store pages show the vendor's products, foods, or services depending on the store type.
- Store owners can share their store using:
  - Copy link
  - QR code
  - Social sharing options
- Unregistered businesses can prepare their store privately.
- Vendors without registered businesses are shown registration assistance messaging.
- Unregistered vendor stores, products, foods, and services are not shown publicly until the business is registered.

## Customer Features

- Customer sign up and sign in.
- Customer account dashboard.
- Delivery address management.
- Saved addresses can include map coordinates for distance estimates and directions.
- Shopping cart that keeps selected items through sign in.
- Checkout flow for placing orders.
- Internal payment session confirmation during checkout.
- Order history.
- Order detail pages showing payment status, payment session, fulfillment progress, store totals, and invoice download.
- Receipt confirmation for delivered products or completed services.
- Receipt confirmation can be completed from the customer dashboard, alerts page, or order detail page.
- Customers can report an order issue instead of confirming receipt when something is wrong.
- Customer alerts for important actions, including delivery confirmation.
- Reviews for products, stores, and services.
- Customers only see review options for items or services they actually received or booked.
- Job application tracking.

## Vendor Features

- Vendor sign up and sign in.
- Vendors choose their store type during sign up, such as products, foods, services, or mixed store.
- Vendor dashboard for managing store operations.
- Store profile management, including name, location, status, and summary.
- Store profiles can include address details and map coordinates so customers can estimate distance and open directions.
- Product and food listing management.
- Service listing management.
- Vendors can save draft listings before registration, but public publishing requires business registration.
- Stock quantity tracking for listings.
- Vendors can update stock from their dashboard.
- Stock is reduced when an order is confirmed.
- Vendor order history.
- Vendor fulfillment controls for preparing, ready for pickup, out for delivery, and fulfilled.
- Vendor wallet dashboard showing available, held, pending checkout, and lifetime earned Market Credits.
- Vendor wallet shows which paid orders are still holding funds and which orders have released funds.
- Vendor ledger export for Market Credit activity.
- Vendor payout details management for saved checkout instructions.
- Vendor access to carts that contain their items, including older carts that may need follow-up offers.
- Discount management.
- Vendors can create, enable, disable, or delete discounts.
- Vendors can apply discounts to specific listings.
- Vendors can offer discounts to carts that have been inactive for a while.
- Subscription management.
- Vendors can select subscription packages.
- Paid subscriptions are intended to activate automatically after payment.
- Vendors can request assistance with business registration.
- Vendors can upload registration or compliance documents.
- Vendor alerts for new orders, subscription due dates, compliance items, and other important updates.

## Admin And Site Owner Features

- Admin dashboard for managing the platform.
- User management.
- Vendor management.
- Store status management.
- Registration status management.
- Product, service, and job moderation.
- Order management.
- Subscription payment review.
- Vendor document review.
- Registration assistance request management.
- Vendor payout request management.
- Wallet audit report for checking vendor credit balances against order and ledger records.
- Wallet repair action for correcting historical balance mismatches.
- Finance console showing customer payments, held credits, available credits, pending checkout credits, and vendor payouts marked paid.
- Vendor wallet balance view by store from the admin dashboard.
- Held-credit order view so the site owner can see which orders are still holding vendor funds.
- Admin visibility into orders waiting for customer receipt confirmation.
- Admin dispute flagging for late receipt confirmation or reported customer issues.
- Vendor ledger inspection and ledger CSV export from the admin dashboard.
- Finance audit log filters for payment sessions, wallet movement, checkout requests, and repair actions.
- Admin alerts for platform activity and compliance issues.
- Tools for reviewing vendor readiness, subscription status, and business compliance.

## Market Credits And Vendor Balances

Urban Market JA includes a digital money system called Market Credits.

- Customer payments are received by the platform.
- Vendor earnings are converted into Market Credits.
- One Market Credit represents one Jamaican dollar.
- If a customer buys from multiple stores in one order, the system splits the order value across the correct vendors.
- Vendor credits are created after an order or service payment session is confirmed, then placed on hold until fulfillment is complete.
- Held credits are released only after product receipt or service completion is confirmed by the customer.
- Held credits remain locked while an order or service issue is open.
- Wallet activity is recorded in a ledger so balances can be audited.
- The site owner can inspect vendor wallet ledgers and audit finance actions from the admin dashboard.
- Vendors can use available credits to pay for subscriptions or product featuring.
- Vendors can request payout of available credits.
- Vendor checkout requests show detail records including amount, status, payout method, payout instructions, and advisory notes.
- When a vendor tries to withdraw their full balance, the system prompts them to consider leaving enough credits for their next subscription payment.

## Orders, Checkout, And Invoices

- Customers can order from more than one vendor in a single cart.
- Checkout supports customer delivery details.
- Checkout records an internal payment session for the order.
- Orders are split internally by vendor so each vendor can manage their own fulfillment.
- The site can generate invoices using the Urban Market JA name and logo.
- Invoices include the store or stores connected to the order.
- Invoices show payment status, payment session, and fulfillment stage.
- Vendor credits remain on hold until delivery or service completion is confirmed.
- Customers can report an issue if a fulfilled order was not received correctly.
- Admins can see and flag late customer receipt confirmations.

## Discounts

- Discounts can be created by vendors.
- Discounts can be applied to listings.
- Discounts can be enabled, disabled, or deleted.
- Discounted products show the changed price visually to customers.
- Discounts can also be offered to carts that have had vendor items sitting for a while.

## Reviews

- Customers can review stores separately from products and services.
- Product reviews are only available after the customer has received the product.
- Store reviews are available after the customer has received an order from that store.
- Service reviews are available after the customer has booked or received a service.
- Reviews are shown as part of the marketplace trust experience.

## Services

- Services can be listed and browsed.
- Services can be searched and filtered.
- Service detail pages show service information, vendor information, and related details.
- Customers can book services.
- Service bookings create a payment session before the vendor begins work.
- Paid service booking value becomes held Market Credits for the vendor.
- Vendors can mark paid service bookings as started or completed.
- Customers confirm completed services before held credits are released.
- Service issues can be reported so held credits stay locked while the site owner reviews them.
- Service activity appears in the customer dashboard and alerts.
- Service vendors can manage service listings from their dashboard.

## Foods

- Food vendors can list food items.
- Food listings appear in the marketplace.
- Food items can connect customers back to the vendor store.
- Food vendors can manage their listings and stock through the vendor dashboard.

## Jobs

- Jobs section for browsing available opportunities.
- Job search and filtering.
- Job detail pages with role information, responsibilities, and requirements.
- Job application support with real PDF resume upload.
- Vendors or admins can create job posts.
- Admins can manage and moderate job posts.
- Vendor-posted jobs are shown publicly only after approval and only when the connected vendor business is registered.

## Alerts And Notifications

- Signed-in users have access to an alerts page.
- Customers receive alerts for important order and delivery actions.
- Customers receive alerts when payments are confirmed, orders are fulfilled, receipts are confirmed, and service bookings need completion confirmation.
- Customers can be prompted to confirm receipt of goods or services.
- Vendors receive alerts for new paid orders, new paid service bookings, customer confirmations, released credits, checkout request updates, subscription reminders, and compliance items.
- Admins receive operational alerts connected to new payment sessions, large held balances, checkout requests, disputes, wallet mismatches, vendors, orders, subscriptions, and compliance.

## Business Registration And Compliance

- Vendors can prepare accounts as unregistered businesses, but public visibility requires registration.
- The site tracks vendor registration status.
- Vendors are shown registration assistance offers when needed.
- Admins can review registration assistance requests.
- Admins can review vendor documents.
- Vendor compliance alerts help track registration and subscription readiness.

## Data Currently Tracked By The Site

The site is designed to track the main records needed for marketplace operation, including:

- Customers
- Vendors
- Stores
- Products
- Foods
- Services
- Jobs
- Orders
- Cart activity
- Stock quantities
- Discounts
- Subscriptions
- Vendor credits and balances
- Credit holds
- Payout requests
- Invoices
- Reviews
- Alerts
- Registration assistance requests
- Vendor documents

## Current Operational Notes

- Product and food orders are connected to cart, checkout, stock, invoices, and vendor credit tracking.
- Public marketplace listings only show registered businesses.
- Vendor credits are designed to stay on hold until product fulfillment or service completion is confirmed by the customer.
- Vendor wallet balances now show the order-level reason for held, released, pending checkout, and available credits.
- Service bookings are available and appear in dashboards, alerts, and review flows.
- Some advanced payment provider behavior may still need to be connected to a live payment account before public launch.
- The site is ready for continued testing with seeded users, vendors, listings, jobs, orders, and dashboard workflows.

## Short Summary

Urban Market JA currently functions as a multi-vendor marketplace where customers can shop, book services, apply for jobs, manage orders, and leave reviews. Vendors can manage stores, listings, discounts, subscriptions, alerts, and earnings through Market Credits, while admins can oversee users, vendors, orders, jobs, compliance, and payout activity from the platform dashboard.
