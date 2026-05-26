# Urban Market JA - Internal Payment And Market Credits Phase Plan

This plan assumes there is **no live external payment gateway connected yet**, but the site is **not intended to operate as an offline/manual-payment system**.

The current site is already designed around internal virtual balances:

- Customer checkout creates a paid order.
- Product stock is reduced when the order is placed.
- Customer payment value is converted into vendor Market Credits.
- Vendor credits are placed in a held balance first.
- Vendors mark orders as fulfilled.
- Customers confirm receipt from their dashboard or alerts.
- Held credits are released into the vendor available balance only after fulfillment and receipt confirmation.
- Vendors can spend available credits on subscriptions and product featuring.
- Vendors can request checkout/payout from available credits.
- Admin can review and mark vendor checkout requests as paid.

The gap is not the wallet model. The main gap is making customer payment capture explicit and auditable while the app is still using the internal/mock provider flow instead of a real payment provider.

## Current Verified Setup

The codebase already includes:

- `vendor_wallet_accounts` for available, held, pending checkout, and lifetime earned credits.
- `vendor_wallet_ledger` for wallet activity history.
- `vendor_checkout_requests` for vendor payout/checkout requests.
- `orders` and `order_items` with payment, fulfillment, customer receipt, and fund release fields.
- `payment_sessions` and `payment_events` for provider-style payment tracking.
- Vendor dashboard wallet view.
- Customer receipt confirmation.
- Admin payment and checkout request management.
- Subscription payment using Market Credits.
- Product featuring using Market Credits.

Important current behavior after Phase 1:

- Customer order creation now creates an order payment session.
- New orders start as pending until the internal/mock payment session is confirmed.
- Vendor held credits are created only when the payment session is marked paid.
- Customer checkout, customer dashboard, vendor dashboard, admin orders, invoices, and admin payment sessions show payment session status.

## Phase 1 - Order Payment Sessions - Completed

**Goal:** Make customer order payment capture explicit without needing a live external provider.

Added:

- `payment_sessions` records for customer checkout orders.
- Payment sessions connected to orders using `payment_sessions.order_id`.
- Internal/mock payment confirmation route for customer orders.
- Order movement through:
  - Created
  - Awaiting payment
  - Paid
  - Fulfilling
  - Fulfilled
  - Received
  - Completed
- Vendor held credits are created after the payment session is marked paid.
- Payment session status is shown in checkout, invoices, customer dashboard, vendor dashboard, and admin dashboard.

Completion check:

- A customer order has a matching payment session.
- Vendor credits are not created until the internal payment session is paid.
- The current mock/internal flow can still complete payment for testing.

## Phase 2 - Held Credits Reliability - Completed

**Goal:** Make the Market Credits hold-and-release process safe.

Added:

- Idempotency checks so the same order item cannot create duplicate held credits.
- Idempotency checks so the same held credits cannot be released twice.
- Ledger verification between:
  - Order item totals
  - Held credits
  - Available credits
  - Pending checkout credits
- Admin repair/report view for wallet mismatch warnings.
- Stronger audit records for fund creation, hold release, wallet spending, and payout marking.
- Database-level unique guard for wallet ledger entries tied to order items.
- Admin repair action that creates missing holds for paid unreleased order items and rebuilds account balances from the ledger.

Completion check:

- One Jamaican dollar in paid order value produces one Market Credit.
- Credits move from held to available only once.
- Admin can detect any balance mismatch.
- Admin can repair detected historical wallet mismatches from the wallet audit report.

## Phase 3 - Checkout And Invoice Clarity - Completed

**Goal:** Make the customer checkout experience clear while using internal payment mode.

Added:

- Checkout screen that clearly shows the selected internal payment method.
- Payment confirmation screen after order placement.
- Invoice payment status:
  - Awaiting payment
  - Paid
  - Fulfillment pending
  - Fulfilled
  - Received
- Multi-vendor invoice sections showing which store receives which portion.
- Customer order detail page with payment session and fulfillment status.
- Customer dashboard links to order detail pages.
- Order invoices include order stage, payment session, payment status, and fulfillment status.

Completion check:

- Customers can understand when the order is paid and what happens next.
- Invoices show the stores attached to the order and the payment status.
- Customers can review store-level order totals, fulfillment status, held/released credit status, and download the invoice from the order detail page.

## Phase 4 - Vendor Wallet And Checkout Flow - Completed

**Goal:** Make vendor balances understandable and operational.

Added:

- Wallet breakdown by:
  - Held credits
  - Available credits
  - Pending checkout credits
  - Lifetime earned credits
- Clear list of which orders are still holding funds.
- Clear list of which orders have released funds.
- Checkout request detail view with payout details, status, timestamps, and advisory messages.
- Vendor payout details management with saved payout instructions.
- Stronger checkout prompt when a vendor tries to withdraw credits needed for the next subscription.
- Vendor ledger export as CSV.
- Vendor order fund status now separates awaiting payment, held funds, released funds, and customer-confirmation waits.

Completion check:

- Vendors can see exactly why credits are held, available, pending, or spent.

## Phase 5 - Admin Finance Console - Completed

**Goal:** Give the site owner the controls needed to operate the internal money system.

Added:

- Admin view for all order payment sessions.
- Admin view for wallet balances by vendor.
- Admin view for held credits by order.
- Admin action to inspect a vendor ledger.
- Admin action to approve, reject, cancel, or mark checkout requests as paid.
- Admin finance audit log filters.
- Finance summary:
  - Total customer payments
  - Total held credits
  - Total available credits
  - Total pending checkout credits
  - Total vendor payouts marked paid
- Admin ledger export for individual vendor wallets.
- Admin audit records for checkout request status changes.

Completion check:

- The site owner can reconcile customer payments, vendor holds, vendor balances, and checkout requests.

## Phase 6 - Fulfillment And Receipt Confirmation - Completed

**Goal:** Protect customers and vendors before releasing funds.

Added:

- Vendor order status buttons:
  - Preparing
  - Ready for pickup
  - Out for delivery
  - Fulfilled
- Customer receipt confirmation from:
  - Customer dashboard
  - Alerts page
  - Order detail page
- Late receipt confirmation reminders.
- Admin visibility into orders waiting on customer confirmation.
- Admin dispute flag when customer does not confirm or reports an issue.
- Customer issue reporting from the dashboard, alerts page, and order detail page.
- Order dispute tracking for open, under review, resolved, and dismissed issues.
- Receipt confirmation is blocked while an order issue is open.

Completion check:

- Vendors cannot cash out held funds before the customer confirms receipt.

## Phase 7 - Services And Bookings Credits - Completed

**Goal:** Bring service bookings into the same payment/hold/release system as products.

Added:

- Payment session for service bookings.
- Held credits for service bookings after payment.
- Vendor service completion action.
- Customer service receipt/completion confirmation.
- Release service credits after completion confirmation.
- Service dispute workflow.
- Vendor dashboard service-booking controls.
- Customer dashboard and alerts service payment/completion actions.
- Admin visibility for held service-booking credits and service disputes.

Completion check:

- Services follow the same protection flow as products.

## Phase 8 - Notifications - Completed

**Goal:** Keep customers, vendors, and admins informed about money movement.

Added:

- Customer alerts for:
  - Payment confirmed
  - Vendor fulfilled order
  - Confirm receipt
  - Receipt confirmed
  - Service payment confirmed
  - Service completed and ready for confirmation
- Vendor alerts for:
  - New paid order
  - Customer confirmed receipt
  - Credits released
  - Checkout request status changed
  - Subscription due soon
  - New paid service booking
  - Service credits released
- Admin alerts for:
  - New payment session
  - Large held balance
  - New checkout request
  - Disputed order
  - Wallet mismatch
  - Service booking disputes
  - Customer and subscription payment confirmations

Completion check:

- Users do not need to guess what happened to payment, delivery, or credits.

## Phase 9 - Test And Launch Hardening

**Goal:** Prove the internal payment and credit flow works before public launch.

Add tests for:

- Cart to checkout.
- Payment session creation.
- Payment confirmation.
- Multi-vendor order split.
- Stock reduction.
- Held credit creation.
- Vendor fulfillment.
- Customer receipt confirmation.
- Held credit release.
- Vendor subscription paid with credits.
- Product featuring paid with credits.
- Vendor checkout request.
- Admin marks checkout request paid.

Completion check:

- A complete customer-to-vendor-money cycle can be tested repeatedly without a live external gateway.

## What Can Wait Until A Live External Provider Exists

- Real card/mobile wallet payment capture.
- Provider-hosted checkout redirect.
- Provider webhook verification for real customer payments.
- Automatic refunds through a provider.
- Saved customer payment methods.
- Automatic bank payouts.
- Provider dispute synchronization.
- Provider reconciliation reports.

## Bottom Line

The site already has the Market Credits wallet structure and the hold-until-receipt model. The next work should not be framed as offline/manual payments. It should make the existing internal/mock payment flow more explicit, auditable, and production-ready until a real external payment provider is connected.
