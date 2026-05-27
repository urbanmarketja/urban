import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { formatCurrency } from './market-data';

type AdminTab = 'overview' | 'users' | 'vendors' | 'orders' | 'jobs' | 'requests' | 'documents' | 'payments';
type UserStatus = 'active' | 'disabled' | 'pending';
type VendorStatus = 'active' | 'disabled' | 'pending';
type RegistrationStatus = 'registered' | 'unregistered' | 'expired';
type JobStatus = 'draft' | 'pending_approval' | 'published' | 'closed' | 'rejected';

interface AdminFinanceSummary {
  totalCustomerPaymentsJmd: number;
  totalSubscriptionPaymentsJmd: number;
  orderPaymentSessionCount: number;
  paidOrderPaymentSessionCount: number;
  totalHeldCredits: number;
  totalAvailableCredits: number;
  totalPendingCheckoutCredits: number;
  totalLifetimeEarnedCredits: number;
  totalVendorPayoutsPaidCredits: number;
  totalVendorPayoutsPaidJmd: number;
  totalVendorPayoutsPendingCredits: number;
  openCheckoutRequestCount: number;
}

interface AdminSummary {
  users: number;
  vendors: number;
  services: number;
  bookings: number;
  applications: number;
  pendingJobs: number;
  paymentSessions: number;
  registrationAssistanceRequests: number;
  finance?: AdminFinanceSummary;
}

interface AdminUser {
  id: string;
  name: string;
  emailPhone: string;
  role: string;
  status: UserStatus;
}

interface AdminVendor {
  id: string;
  name: string;
  location?: string;
  status: VendorStatus;
  registrationStatus: RegistrationStatus;
  subscriptionStatus?: string;
  subscriptionPlan?: string;
}

interface AdminJob {
  id: string;
  title: string;
  employer: string;
  category?: string;
  location?: string;
  status: JobStatus | string;
}

interface AdminOrder {
  orderId: string;
  vendorId: string;
  vendorName: string;
  customerName: string;
  customerContact: string;
  status: string;
  paymentStatus: string;
  paymentSessionStatus?: string;
  paymentSessionId?: string;
  fulfillmentStatus: string;
  fundStatus?: string;
  vendorTotal: number;
  heldCredits?: number;
  releasedCredits?: number;
  pendingPaymentCredits?: number;
  waitingReceiptSince?: string | null;
  daysWaitingForReceipt?: number;
  isReceiptLate?: boolean;
  hasOpenDispute?: boolean;
  disputeStatus?: string | null;
  itemCount: number;
  createdAt: string;
}

interface PaymentSessionRow {
  id: string;
  provider: string;
  providerSessionId: string;
  vendorId?: string | null;
  vendorName?: string;
  orderId?: string | null;
  serviceBookingId?: string | null;
  serviceName?: string;
  planId?: string | null;
  planName?: string;
  kind?: string;
  amount: number;
  status: string;
  checkoutUrl: string;
  createdAt: string;
  paidAt?: string | null;
}

interface AdminServiceBooking {
  id: string;
  vendorId: string;
  vendorName: string;
  customerName: string;
  customerContact: string;
  serviceName: string;
  status: string;
  paymentStatus: string;
  paymentSessionStatus?: string;
  paymentSessionId?: string;
  fundStatus?: string;
  total: number;
  heldCredits?: number;
  releasedCredits?: number;
  date: string;
  time: string;
  bookedAt: string;
  vendorCompletedAt?: string | null;
  hasOpenDispute?: boolean;
  disputeStatus?: string | null;
}

interface WalletAuditRow {
  vendorId: string;
  vendorName: string;
  status: string;
  accountHeldCoins: number;
  ledgerHeldCoins: number;
  expectedHeldCoins: number;
  accountAvailableCoins: number;
  ledgerAvailableCoins: number;
  accountPendingCheckoutCoins: number;
  ledgerPendingCheckoutCoins: number;
  accountLifetimeEarnedCoins: number;
  ledgerLifetimeEarnedCoins: number;
  duplicateLedgerGroups: number;
  mismatches: string[];
}

interface WalletLedgerEntry {
  id: string;
  vendorId: string;
  orderId?: string | null;
  serviceBookingId?: string | null;
  checkoutRequestId?: string | null;
  paymentSessionId?: string | null;
  entryType: string;
  balanceBucket: string;
  direction: string;
  amountCoins: number;
  amountJmd: number;
  description?: string;
  createdAt: string;
}

interface AdminAuditLogRow {
  id: string;
  adminName: string;
  adminLogin?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: unknown;
  createdAt: string;
}

@Component({
  selector: 'app-admin-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Owner access only</p>
          <h1>Admin operations console</h1>
          <p>Manage users, vendors, jobs, compliance, documents, and payments from one workspace.</p>
        </div>
      </section>

      <section class="container section">
        @if (!auth.ensureRole('admin')) {
          <div class="notice error">
            <strong>Restricted dashboard</strong>
            <p>Sign in as Admin / Owner to manage marketplace operations.</p>
            <a class="button primary-button" routerLink="/login">Owner login</a>
          </div>
        }

        <div class="admin-kpis">
          <article><span>Users</span><strong>{{ summary()?.users ?? users().length }}</strong></article>
          <article><span>Vendors</span><strong>{{ summary()?.vendors ?? adminVendors().length }}</strong></article>
          <article><span>Open alerts</span><strong>{{ complianceAlerts().length }}</strong></article>
          <article><span>Orders</span><strong>{{ adminOrders().length }}</strong></article>
          <article><span>Pending jobs</span><strong>{{ pendingJobs().length }}</strong></article>
          <article><span>Documents</span><strong>{{ operations()?.documents?.length ?? 0 }}</strong></article>
          <article><span>Payments</span><strong>{{ paymentEvents().length }}</strong></article>
        </div>

        <div class="admin-toolbar">
          <div class="admin-tabs" role="tablist" aria-label="Admin sections">
            @for (tab of tabs; track tab.value) {
              <button type="button" [class.active]="activeTab() === tab.value" (click)="activeTab.set(tab.value)">
                {{ tab.label }}
              </button>
            }
          </div>
          <div class="admin-tools">
            <input type="search" [(ngModel)]="search" placeholder="Search current section">
            <select [(ngModel)]="statusFilter">
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="disabled">Disabled</option>
              <option value="published">Published</option>
              <option value="pending_approval">Pending approval</option>
              <option value="rejected">Rejected</option>
              <option value="registered">Registered</option>
              <option value="unregistered">Unregistered</option>
              <option value="expired">Expired</option>
              <option value="paid">Paid</option>
              <option value="requested">Requested</option>
              <option value="approved">Approved</option>
              <option value="cancelled">Cancelled</option>
              <option value="mismatch">Mismatch</option>
              <option value="ok">OK</option>
            </select>
            <button class="button-sm" type="button" (click)="loadOperations()">Refresh</button>
          </div>
        </div>

        @if (activeTab() === 'overview') {
          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Operations Overview</h2>
                <p>Platform totals and urgent queues.</p>
              </div>
              <button class="button-sm" type="button" (click)="runCompliance()">Run compliance automation</button>
            </div>
            <div class="admin-summary-grid">
              <article><strong>{{ summary()?.services ?? 0 }}</strong><span>Services</span></article>
              <article><strong>{{ summary()?.bookings ?? 0 }}</strong><span>Bookings</span></article>
              <article><strong>{{ summary()?.applications ?? 0 }}</strong><span>Applications</span></article>
              <article><strong>{{ summary()?.registrationAssistanceRequests ?? 0 }}</strong><span>Registration requests</span></article>
              <article><strong>{{ summary()?.paymentSessions ?? 0 }}</strong><span>Payment sessions</span></article>
              <article><strong>{{ money(0) }}</strong><span>Revenue wiring pending</span></article>
            </div>
          </section>
        }

        @if (activeTab() === 'users') {
          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>User Management</h2>
                <p>Activate or disable platform accounts.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Name</th><th>Login</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (user of filteredUsers(); track user.id) {
                    <tr>
                      <td>{{ user.name }}</td>
                      <td>{{ user.emailPhone }}</td>
                      <td><span class="status-pill">{{ user.role }}</span></td>
                      <td><span class="status-pill" [class.warn]="user.status !== 'active'">{{ user.status }}</span></td>
                      <td class="action-cell">
                        @if (user.status === 'active') {
                          <button class="button-sm danger" type="button" (click)="updateUserStatus(user.id, 'disabled')">Disable</button>
                        } @else {
                          <button class="button-sm" type="button" (click)="updateUserStatus(user.id, 'active')">Activate</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (activeTab() === 'vendors') {
          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Vendor Management</h2>
                <p>Control vendor status, registration standing, and publishing readiness.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Vendor</th><th>Location</th><th>Store</th><th>Registration</th><th>Subscription</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (vendor of filteredVendors(); track vendor.id) {
                    <tr>
                      <td>{{ vendor.name }}</td>
                      <td>{{ vendor.location || 'Not set' }}</td>
                      <td><span class="status-pill" [class.warn]="vendor.status !== 'active'">{{ vendor.status }}</span></td>
                      <td><span class="status-pill" [class.warn]="vendor.registrationStatus !== 'registered'">{{ vendor.registrationStatus }}</span></td>
                      <td>{{ vendor.subscriptionPlan || 'No plan' }} / {{ vendor.subscriptionStatus || 'none' }}</td>
                      <td class="action-cell">
                        @if (vendor.status === 'active') {
                          <button class="button-sm danger" type="button" (click)="updateVendor(vendor.id, { status: 'disabled' })">Disable</button>
                        } @else {
                          <button class="button-sm" type="button" (click)="updateVendor(vendor.id, { status: 'active' })">Activate</button>
                        }
                        @if (vendor.registrationStatus === 'registered') {
                          <button class="button-sm danger" type="button" (click)="updateVendor(vendor.id, { registrationStatus: 'expired' })">Expire</button>
                        } @else {
                          <button class="button-sm" type="button" (click)="updateVendor(vendor.id, { registrationStatus: 'registered' })">Register</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (activeTab() === 'orders') {
          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Order Management</h2>
                <p>Monitor store order slices and update platform order status.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Order</th><th>Store</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (order of filteredOrders(); track order.orderId + order.vendorId) {
                    <tr>
                      <td><strong>{{ order.orderId }}</strong><br><span class="product-meta">{{ order.createdAt }}</span></td>
                      <td>{{ order.vendorName }}</td>
                      <td>{{ order.customerName }}<br><span class="product-meta">{{ order.customerContact }}</span></td>
                      <td>{{ money(order.vendorTotal) }}</td>
                      <td>
                        <span class="status-pill" [class.warn]="order.paymentStatus !== 'paid'">{{ order.paymentSessionStatus || order.paymentStatus }}</span><br>
                        <span class="product-meta">{{ order.paymentSessionId || 'No session' }}</span>
                      </td>
                      <td><span class="status-pill" [class.warn]="order.status !== 'completed'">{{ order.status }}</span></td>
                      <td class="action-cell">
                        @if (order.paymentStatus !== 'paid') {
                          @if (order.paymentSessionId) {
                            <button class="button-sm" type="button" (click)="confirmPaymentSession(order.paymentSessionId)">Confirm payment</button>
                          } @else {
                            <button class="button-sm" type="button" (click)="updateOrder(order.orderId, { paymentStatus: 'paid', status: 'paid' })">Mark paid</button>
                          }
                        }
                        @if (order.status !== 'fulfilling' && order.status !== 'completed' && order.status !== 'cancelled') {
                          <button class="button-sm" type="button" (click)="updateOrder(order.orderId, { status: 'fulfilling' })">Fulfill</button>
                        }
                        @if (order.status !== 'completed') {
                          <button class="button-sm" type="button" (click)="updateOrder(order.orderId, { status: 'completed' })">Complete</button>
                        }
                        @if (order.status !== 'cancelled' && order.status !== 'completed') {
                          <button class="button-sm danger" type="button" (click)="updateOrder(order.orderId, { status: 'cancelled' })">Cancel</button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7">No orders found.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (activeTab() === 'jobs') {
          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Job Moderation</h2>
                <p>Approve, reject, or close job listings.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Title</th><th>Employer</th><th>Category</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (job of filteredJobs(); track job.id) {
                    <tr>
                      <td>{{ job.title }}</td>
                      <td>{{ job.employer }}</td>
                      <td>{{ job.category || 'Other' }}</td>
                      <td>{{ job.location || 'Not set' }}</td>
                      <td><span class="status-pill" [class.warn]="job.status !== 'published'">{{ job.status }}</span></td>
                      <td class="action-cell">
                        @if (job.status !== 'published') {
                          <button class="button-sm" type="button" (click)="updateJob(job.id, 'published')">Approve</button>
                        }
                        @if (job.status !== 'rejected' && job.status !== 'closed' && job.status !== 'published') {
                          <button class="button-sm danger" type="button" (click)="updateJob(job.id, 'rejected')">Reject</button>
                        }
                        @if (job.status !== 'closed') {
                          <button class="button-sm" type="button" (click)="updateJob(job.id, 'closed')">Close</button>
                        } @else {
                          <span class="action-note">Closed</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (activeTab() === 'requests') {
          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Registration Assistance</h2>
                <p>Move registration support requests through the admin workflow.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Vendor</th><th>Request</th><th>Status</th><th>Next step</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (request of filteredRequests(); track request.id) {
                    <tr>
                      <td>{{ request.vendor }}</td>
                      <td>{{ request.id }}</td>
                      <td><span class="status-pill" [class.warn]="request.status !== 'completed'">{{ request.status }}</span></td>
                      <td>{{ request.nextStep || request.notes || 'Review request' }}</td>
                      <td class="action-cell">
                        @if (request.status !== 'completed' && request.status !== 'cancelled') {
                          @if (request.status !== 'in_review') {
                            <button class="button-sm" type="button" (click)="updateRegistration(request.id, 'in_review')">Review</button>
                          }
                          @if (request.status !== 'waiting_on_vendor') {
                            <button class="button-sm" type="button" (click)="updateRegistration(request.id, 'waiting_on_vendor')">Need vendor</button>
                          }
                          <button class="button-sm" type="button" (click)="updateRegistration(request.id, 'completed')">Complete</button>
                          <button class="button-sm danger" type="button" (click)="updateRegistration(request.id, 'cancelled')">Cancel</button>
                        } @else {
                          <span class="action-note">{{ request.status }}</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (activeTab() === 'documents') {
          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Document Review</h2>
                <p>Approve or reject vendor registration documents.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Vendor</th><th>Document</th><th>Status</th><th>File</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (document of filteredDocuments(); track document.id) {
                    <tr>
                      <td>{{ document.vendor }}</td>
                      <td>{{ document.documentType }}</td>
                      <td><span class="status-pill" [class.warn]="document.status !== 'approved'">{{ document.status }}</span></td>
                      <td class="truncate-cell">{{ documentName(document) }}</td>
                      <td class="action-cell">
                        <button class="button-sm" type="button" (click)="downloadDocument(document)">Download</button>
                        @if (document.status !== 'approved') {
                          <button class="button-sm" type="button" (click)="reviewDocument(document.id, 'approved')">Approve</button>
                        }
                        @if (document.status !== 'rejected') {
                          <button class="button-sm danger" type="button" (click)="reviewDocument(document.id, 'rejected')">Reject</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (activeTab() === 'payments') {
          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Finance Summary</h2>
                <p>Owner-level totals for customer payments, wallet balances, and paid vendor checkouts.</p>
              </div>
            </div>
            <div class="finance-summary-grid">
              <article><strong>{{ money(financeSummary().totalCustomerPaymentsJmd) }}</strong><span>Total customer payments</span></article>
              <article><strong>{{ financeSummary().totalHeldCredits }}</strong><span>Held credits</span></article>
              <article><strong>{{ financeSummary().totalAvailableCredits }}</strong><span>Available credits</span></article>
              <article><strong>{{ financeSummary().totalPendingCheckoutCredits }}</strong><span>Pending checkout credits</span></article>
              <article><strong>{{ money(financeSummary().totalVendorPayoutsPaidJmd) }}</strong><span>Vendor payouts marked paid</span></article>
              <article><strong>{{ financeSummary().openCheckoutRequestCount }}</strong><span>Open checkout requests</span></article>
            </div>
          </section>

          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Vendor Wallet Balances</h2>
                <p>Compare each vendor account balance before approving or paying checkout requests.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Vendor</th><th>Available</th><th>Held</th><th>Pending checkout</th><th>Lifetime earned</th><th>Next reserve</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (wallet of filteredWalletBalances(); track wallet.vendorId) {
                    <tr>
                      <td>{{ wallet.vendorName }}</td>
                      <td>{{ wallet.availableCoins }} credits</td>
                      <td>{{ wallet.heldCoins }} credits</td>
                      <td>{{ wallet.pendingCheckoutCoins }} credits</td>
                      <td>{{ wallet.lifetimeEarnedCoins }} credits</td>
                      <td>{{ wallet.nextSubscriptionCost || 0 }} credits</td>
                      <td class="action-cell">
                        <button class="button-sm" type="button" (click)="inspectVendorLedger(wallet.vendorId)">Inspect ledger</button>
                        <button class="button-sm" type="button" (click)="exportVendorLedger(wallet.vendorId)">Export CSV</button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7">No vendor wallets found.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          @if (selectedLedgerVendorId()) {
            <section class="admin-panel">
              <div class="admin-panel-header">
                <div>
                  <h2>Vendor Ledger Detail</h2>
                  <p>{{ vendorName(selectedLedgerVendorId()) }} wallet entries from newest to oldest.</p>
                </div>
                <button class="button-sm" type="button" (click)="selectedLedgerVendorId.set('')">Close ledger</button>
              </div>
              <div class="table-wrap">
                <table class="admin-table">
                  <thead><tr><th>Date</th><th>Type</th><th>Bucket</th><th>Direction</th><th>Credits</th><th>Order / Service / Checkout</th><th>Description</th></tr></thead>
                  <tbody>
                    @for (entry of filteredSelectedLedger(); track entry.id) {
                      <tr>
                        <td>{{ entry.createdAt }}</td>
                        <td>{{ entry.entryType }}</td>
                        <td>{{ entry.balanceBucket }}</td>
                        <td><span class="status-pill" [class.warn]="entry.direction === 'debit'">{{ entry.direction }}</span></td>
                        <td>{{ entry.direction === 'credit' ? '+' : '-' }}{{ entry.amountCoins }}</td>
                        <td>{{ entry.orderId || entry.serviceBookingId || entry.checkoutRequestId || entry.paymentSessionId || 'N/A' }}</td>
                        <td>{{ entry.description || 'No description' }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="7">No ledger entries match the current filters.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }

          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Held Credits By Order</h2>
                <p>Paid vendor order portions that still hold credits until fulfillment and customer receipt.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Order</th><th>Vendor</th><th>Customer</th><th>Held credits</th><th>Released</th><th>Payment</th><th>Fulfillment</th><th>Waiting</th><th>Issue</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (order of filteredHeldCreditOrders(); track order.orderId + order.vendorId) {
                    <tr>
                      <td>{{ order.orderId }}<br><span class="product-meta">{{ order.createdAt }}</span></td>
                      <td>{{ order.vendorName }}</td>
                      <td>{{ order.customerName }}<br><span class="product-meta">{{ order.customerContact }}</span></td>
                      <td>{{ order.heldCredits || 0 }} credits</td>
                      <td>{{ order.releasedCredits || 0 }} credits</td>
                      <td><span class="status-pill" [class.warn]="order.paymentStatus !== 'paid'">{{ order.paymentSessionStatus || order.paymentStatus }}</span></td>
                      <td><span class="status-pill" [class.warn]="order.fulfillmentStatus !== 'fulfilled'">{{ order.fulfillmentStatus }}</span></td>
                      <td>{{ order.waitingReceiptSince || 'Not fulfilled' }}<br><span class="product-meta">{{ order.daysWaitingForReceipt || 0 }} day(s)</span></td>
                      <td><span class="status-pill" [class.warn]="order.hasOpenDispute">{{ order.disputeStatus || 'none' }}</span></td>
                      <td class="action-cell">
                        @if (!order.hasOpenDispute && (order.fundStatus === 'waiting_customer' || order.isReceiptLate)) {
                          <button class="button-sm danger" type="button" (click)="flagOrderDispute(order)">Flag dispute</button>
                        } @else {
                          <span class="action-note">{{ order.fundStatus || 'held' }}</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="10">No paid orders are currently holding vendor credits.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Held Credits By Service Booking</h2>
                <p>Paid service bookings that still hold credits until the vendor completes the work and the customer confirms.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Booking</th><th>Vendor</th><th>Customer</th><th>Held credits</th><th>Released</th><th>Payment</th><th>Status</th><th>Issue</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (booking of filteredHeldServiceBookings(); track booking.id) {
                    <tr>
                      <td>{{ booking.serviceName }}<br><span class="product-meta">{{ booking.id }} - {{ booking.date }} {{ booking.time }}</span></td>
                      <td>{{ booking.vendorName }}</td>
                      <td>{{ booking.customerName }}<br><span class="product-meta">{{ booking.customerContact }}</span></td>
                      <td>{{ booking.heldCredits || 0 }} credits</td>
                      <td>{{ booking.releasedCredits || 0 }} credits</td>
                      <td><span class="status-pill" [class.warn]="booking.paymentStatus !== 'paid'">{{ booking.paymentSessionStatus || booking.paymentStatus }}</span></td>
                      <td><span class="status-pill" [class.warn]="booking.fundStatus !== 'released'">{{ booking.status }} / {{ booking.fundStatus }}</span></td>
                      <td><span class="status-pill" [class.warn]="booking.hasOpenDispute">{{ booking.disputeStatus || 'none' }}</span></td>
                      <td class="action-cell">
                        @if (!booking.hasOpenDispute && booking.fundStatus === 'waiting_customer') {
                          <button class="button-sm danger" type="button" (click)="flagServiceBookingDispute(booking)">Flag dispute</button>
                        } @else {
                          <span class="action-note">{{ booking.fundStatus || 'held' }}</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="9">No paid service bookings are currently holding vendor credits.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Payment Sessions</h2>
                <p>Order and service payments create held vendor credits; subscription payments activate plans.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Session</th><th>Type</th><th>Provider</th><th>Order / Plan</th><th>Amount</th><th>Status</th><th>Paid</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (session of filteredPaymentSessions(); track session.id) {
                    <tr>
                      <td>{{ session.id }}</td>
                      <td>{{ session.kind || 'payment' }}</td>
                      <td>{{ session.provider }}</td>
                      <td>{{ session.orderId || session.serviceName || session.serviceBookingId || session.planName || session.planId || 'N/A' }}</td>
                      <td>{{ money(session.amount) }}</td>
                      <td><span class="status-pill" [class.warn]="session.status !== 'paid'">{{ session.status }}</span></td>
                      <td>{{ session.paidAt || 'Not paid' }}</td>
                      <td class="action-cell">
                        @if (session.provider === 'mock' && session.status !== 'paid') {
                          <button class="button-sm" type="button" (click)="confirmPaymentSession(session.id)">Confirm mock payment</button>
                        } @else {
                          <span class="action-note">No action</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="8">No payment sessions found.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Vendor Checkout Requests</h2>
                <p>Credits requested for owner payout after customer-confirmed releases.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Request</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Payout</th><th>Advisory</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (request of filteredCheckoutRequests(); track request.id) {
                    <tr>
                      <td>{{ request.id }}</td>
                      <td>{{ vendorName(request.vendorId) }}</td>
                      <td>{{ request.amountCoins }} credits</td>
                      <td><span class="status-pill" [class.warn]="request.status !== 'paid'">{{ request.status }}</span></td>
                      <td>{{ request.payoutMethod || 'N/A' }}<br><span class="product-meta">{{ request.payoutDetails || 'No details saved' }}</span></td>
                      <td>{{ request.advisoryMessage || 'None' }}</td>
                      <td class="action-cell">
                        @if (request.status === 'requested') {
                          <button class="button-sm" type="button" (click)="updateCheckoutRequest(request.id, 'approved')">Approve</button>
                          <button class="button-sm danger" type="button" (click)="updateCheckoutRequest(request.id, 'rejected')">Reject</button>
                        }
                        @if (request.status === 'approved' || request.status === 'requested') {
                          <button class="button-sm" type="button" (click)="updateCheckoutRequest(request.id, 'paid')">Mark paid</button>
                          <button class="button-sm danger" type="button" (click)="updateCheckoutRequest(request.id, 'cancelled')">Cancel</button>
                        } @else {
                          <span class="action-note">Finalized</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7">No checkout requests found.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Wallet Audit</h2>
                <p>Compares vendor account balances with ledger entries and paid order item totals.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Vendor</th><th>Status</th><th>Held</th><th>Available</th><th>Pending</th><th>Lifetime</th><th>Warnings</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (audit of filteredWalletAudit(); track audit.vendorId) {
                    <tr>
                      <td>{{ audit.vendorName }}</td>
                      <td><span class="status-pill" [class.warn]="audit.status !== 'ok'">{{ audit.status }}</span></td>
                      <td>{{ audit.accountHeldCoins }} acct / {{ audit.ledgerHeldCoins }} ledger / {{ audit.expectedHeldCoins }} orders</td>
                      <td>{{ audit.accountAvailableCoins }} acct / {{ audit.ledgerAvailableCoins }} ledger</td>
                      <td>{{ audit.accountPendingCheckoutCoins }} acct / {{ audit.ledgerPendingCheckoutCoins }} ledger</td>
                      <td>{{ audit.accountLifetimeEarnedCoins }} acct / {{ audit.ledgerLifetimeEarnedCoins }} ledger</td>
                      <td>{{ audit.mismatches.length ? audit.mismatches.join(', ') : 'None' }}</td>
                      <td class="action-cell">
                        @if (audit.status !== 'ok') {
                          <button class="button-sm" type="button" (click)="repairWalletAudit(audit.vendorId)">Repair</button>
                        } @else {
                          <span class="action-note">Balanced</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="8">No wallet audit records found.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Payment Events</h2>
                <p>Review provider webhook processing status.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Provider</th><th>Event</th><th>Provider ID</th><th>Status</th><th>Received</th></tr></thead>
                <tbody>
                  @for (event of filteredPaymentEvents(); track event.id) {
                    <tr>
                      <td>{{ event.provider }}</td>
                      <td>{{ event.eventType }}</td>
                      <td>{{ event.providerEventId }}</td>
                      <td><span class="status-pill" [class.warn]="!event.processedAt">{{ event.processedAt ? 'processed' : 'pending' }}</span></td>
                      <td>{{ event.createdAt || event.processedAt || 'Not available' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="admin-panel">
            <div class="admin-panel-header">
              <div>
                <h2>Finance Audit Logs</h2>
                <p>Filter admin and system actions connected to payments, wallet movement, and checkout requests.</p>
              </div>
            </div>
            <div class="admin-filter-row">
              <label>Action
                <select [(ngModel)]="auditActionFilter">
                  <option value="all">All finance actions</option>
                  <option value="payment_session_mark_paid">Payment marked paid</option>
                  <option value="checkout_request_status_update">Checkout request status update</option>
                  <option value="wallet_order_hold">Wallet order hold</option>
                  <option value="wallet_order_release">Wallet order release</option>
                  <option value="wallet_checkout_request">Wallet checkout request</option>
                  <option value="wallet_checkout_paid">Wallet checkout paid</option>
                  <option value="wallet_repair">Wallet repair</option>
                </select>
              </label>
              <label>Entity
                <select [(ngModel)]="auditEntityFilter">
                  <option value="all">All finance entities</option>
                  <option value="payment_session">Payment session</option>
                  <option value="vendor_checkout_request">Vendor checkout request</option>
                  <option value="vendor_wallet_ledger">Vendor wallet ledger</option>
                  <option value="vendor_wallet_account">Vendor wallet account</option>
                </select>
              </label>
            </div>
            <div class="table-wrap">
              <table class="admin-table">
                <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
                <tbody>
                  @for (log of filteredAuditLogs(); track log.id) {
                    <tr>
                      <td>{{ log.createdAt }}</td>
                      <td>{{ log.adminName }}<br><span class="product-meta">{{ log.adminLogin || 'System action' }}</span></td>
                      <td>{{ log.action }}</td>
                      <td>{{ log.entityType }}<br><span class="product-meta">{{ log.entityId || 'N/A' }}</span></td>
                      <td class="truncate-cell">{{ auditDetails(log) }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="5">No finance audit logs match the current filters.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (message()) {
          <div class="notice">{{ message() }}</div>
        }
      </section>
    </main>
  `
})
export class AdminPage implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly money = formatCurrency;
  protected readonly summary = signal<AdminSummary | null>(null);
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly adminVendors = signal<AdminVendor[]>([]);
  protected readonly jobs = signal<AdminJob[]>([]);
  protected readonly operations = signal<any | null>(null);
  protected readonly adminOrders = computed<AdminOrder[]>(() => this.operations()?.orders ?? []);
  protected readonly adminServiceBookings = computed<AdminServiceBooking[]>(() => this.operations()?.bookings ?? []);
  protected readonly complianceAlerts = signal<Array<{ id: string; vendorName: string; severity: string; message: string }>>([]);
  protected readonly paymentSessions = signal<PaymentSessionRow[]>([]);
  protected readonly paymentEvents = signal<Array<{ id: string; provider: string; providerEventId: string; eventType: string; processedAt: string | null; createdAt?: string }>>([]);
  protected readonly finance = signal<AdminFinanceSummary | null>(null);
  protected readonly auditLogs = signal<AdminAuditLogRow[]>([]);
  protected readonly selectedLedgerVendorId = signal('');
  protected readonly selectedLedgerEntries = signal<WalletLedgerEntry[]>([]);
  protected readonly message = signal('');
  protected readonly activeTab = signal<AdminTab>('overview');
  protected search = '';
  protected statusFilter = 'all';
  protected auditActionFilter = 'all';
  protected auditEntityFilter = 'all';

  protected readonly tabs: Array<{ value: AdminTab; label: string }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'users', label: 'Users' },
    { value: 'vendors', label: 'Vendors' },
    { value: 'orders', label: 'Orders' },
    { value: 'jobs', label: 'Jobs' },
    { value: 'requests', label: 'Requests' },
    { value: 'documents', label: 'Documents' },
    { value: 'payments', label: 'Payments' }
  ];

  protected readonly pendingJobs = computed(() => this.jobs().filter((job) => job.status === 'pending_approval' || job.status === 'Draft'));

  ngOnInit(): void {
    void this.loadOperations();
  }

  protected financeSummary(): AdminFinanceSummary {
    return this.finance() ?? this.summary()?.finance ?? {
      totalCustomerPaymentsJmd: 0,
      totalSubscriptionPaymentsJmd: 0,
      orderPaymentSessionCount: 0,
      paidOrderPaymentSessionCount: 0,
      totalHeldCredits: 0,
      totalAvailableCredits: 0,
      totalPendingCheckoutCredits: 0,
      totalLifetimeEarnedCredits: 0,
      totalVendorPayoutsPaidCredits: 0,
      totalVendorPayoutsPaidJmd: 0,
      totalVendorPayoutsPendingCredits: 0,
      openCheckoutRequestCount: 0
    };
  }

  protected filteredUsers(): AdminUser[] {
    return this.users().filter((user) => this.matches([user.name, user.emailPhone, user.role, user.status]) && this.matchesStatus(user.status));
  }

  protected filteredVendors(): AdminVendor[] {
    return this.adminVendors().filter((vendor) => this.matches([vendor.name, vendor.location, vendor.status, vendor.registrationStatus, vendor.subscriptionPlan]) && this.matchesStatus(vendor.status, vendor.registrationStatus));
  }

  protected filteredJobs(): AdminJob[] {
    return this.jobs().filter((job) => this.matches([job.title, job.employer, job.category, job.location, job.status]) && this.matchesStatus(String(job.status)));
  }

  protected filteredOrders(): AdminOrder[] {
    return this.adminOrders().filter((order) => this.matches([order.orderId, order.paymentSessionId, order.vendorName, order.customerName, order.customerContact, order.status, order.paymentStatus, order.paymentSessionStatus, order.fulfillmentStatus]) && this.matchesStatus(order.status, order.paymentStatus, order.paymentSessionStatus || '', order.fulfillmentStatus));
  }

  protected filteredRequests(): any[] {
    return (this.operations()?.registrationRequests ?? []).filter((request: any) => this.matches([request.vendor, request.id, request.status, request.nextStep, request.notes]) && this.matchesStatus(request.status));
  }

  protected filteredDocuments(): any[] {
    return (this.operations()?.documents ?? []).filter((document: any) => this.matches([document.vendor, document.documentType, document.status, document.fileUrl]) && this.matchesStatus(document.status));
  }

  protected filteredPaymentEvents(): Array<{ id: string; provider: string; providerEventId: string; eventType: string; processedAt: string | null; createdAt?: string }> {
    return this.paymentEvents().filter((event) => this.matches([event.provider, event.providerEventId, event.eventType, event.processedAt ? 'processed' : 'pending']) && this.matchesStatus(event.processedAt ? 'processed' : 'pending'));
  }

  protected filteredPaymentSessions(): PaymentSessionRow[] {
    return this.paymentSessions().filter((session) => this.matches([session.id, session.provider, session.kind, session.orderId, session.serviceBookingId, session.serviceName, session.planName, session.planId, session.status]) && this.matchesStatus(session.status));
  }

  protected filteredWalletBalances(): any[] {
    return (this.operations()?.wallets ?? [])
      .filter((wallet: any) => this.matches([wallet.vendorName, wallet.vendorId, wallet.availableCoins, wallet.heldCoins, wallet.pendingCheckoutCoins, wallet.lifetimeEarnedCoins]));
  }

  protected filteredHeldCreditOrders(): AdminOrder[] {
    return this.adminOrders()
      .filter((order) => Number(order.heldCredits || 0) > 0)
      .filter((order) => this.matches([order.orderId, order.vendorName, order.customerName, order.customerContact, order.paymentStatus, order.fulfillmentStatus, order.fundStatus]) && this.matchesStatus(order.paymentStatus, order.fulfillmentStatus, order.fundStatus || 'held'));
  }

  protected filteredHeldServiceBookings(): AdminServiceBooking[] {
    return this.adminServiceBookings()
      .filter((booking) => Number(booking.heldCredits || 0) > 0)
      .filter((booking) => this.matches([booking.id, booking.vendorName, booking.customerName, booking.customerContact, booking.serviceName, booking.paymentStatus, booking.status, booking.fundStatus]) && this.matchesStatus(booking.paymentStatus, booking.status, booking.fundStatus || 'held'));
  }

  protected filteredSelectedLedger(): WalletLedgerEntry[] {
    return this.selectedLedgerEntries()
      .filter((entry) => this.matches([entry.entryType, entry.balanceBucket, entry.direction, entry.orderId, entry.serviceBookingId, entry.checkoutRequestId, entry.paymentSessionId, entry.description]) && this.matchesStatus(entry.balanceBucket, entry.direction, entry.entryType));
  }

  protected filteredCheckoutRequests(): any[] {
    return (this.operations()?.checkoutRequests ?? []).filter((request: any) => this.matches([request.id, request.vendorId, this.vendorName(request.vendorId), request.status, request.payoutMethod, request.payoutDetails, request.advisoryMessage]) && this.matchesStatus(request.status));
  }

  protected filteredWalletAudit(): WalletAuditRow[] {
    return ((this.operations()?.walletAudit ?? []) as WalletAuditRow[])
      .filter((audit) => this.matches([audit.vendorName, audit.status, audit.mismatches.join(' ')]) && this.matchesStatus(audit.status));
  }

  protected filteredAuditLogs(): AdminAuditLogRow[] {
    return this.auditLogs()
      .filter((log) => this.auditActionFilter === 'all' || log.action === this.auditActionFilter)
      .filter((log) => this.auditEntityFilter === 'all' || log.entityType === this.auditEntityFilter)
      .filter((log) => this.matches([log.adminName, log.adminLogin, log.action, log.entityType, log.entityId, this.auditDetails(log)]));
  }

  protected vendorName(vendorId: string): string {
    return this.adminVendors().find((vendor) => vendor.id === vendorId)?.name || vendorId;
  }

  protected async loadOperations(): Promise<void> {
    try {
      const headers = this.auth.authHeaders();
      const [summary, users, vendors, jobs, operations, sessions, events, alerts, finance, auditLogs] = await Promise.all([
        fetch(apiUrl('/api/dashboard/admin'), { headers }),
        fetch(apiUrl('/api/users'), { headers }),
        fetch(apiUrl('/api/vendors?all=true'), { headers }),
        fetch(apiUrl('/api/jobs?all=true'), { headers }),
        fetch(apiUrl('/api/vendor/operations'), { headers }),
        fetch(apiUrl('/api/payments/sessions'), { headers }),
        fetch(apiUrl('/api/payments/events'), { headers }),
        fetch(apiUrl('/api/compliance/alerts'), { headers }),
        fetch(apiUrl('/api/admin/finance-summary'), { headers }),
        fetch(apiUrl('/api/admin/audit-logs'), { headers })
      ]);

      if (summary.ok) this.summary.set(await summary.json());
      if (users.ok) this.users.set(await users.json());
      if (vendors.ok) this.adminVendors.set(await vendors.json());
      if (jobs.ok) this.jobs.set(await jobs.json());
      if (operations.ok) this.operations.set(await operations.json());
      if (sessions.ok) this.paymentSessions.set(await sessions.json());
      if (events.ok) this.paymentEvents.set(await events.json());
      if (alerts.ok) this.complianceAlerts.set(await alerts.json());
      if (finance.ok) this.finance.set(await finance.json());
      if (auditLogs.ok) this.auditLogs.set(await auditLogs.json());
    } catch {
      this.message.set('Admin workflow API is unavailable.');
    }
  }

  protected async runCompliance(): Promise<void> {
    await this.post('/api/compliance/run', {}, 'Compliance automation completed.');
  }

  protected async updateJob(id: string, status: JobStatus): Promise<void> {
    await this.post(`/api/jobs/${id}/manage`, { status }, `Job marked ${status}.`);
  }

  protected async updateOrder(id: string, body: Partial<{ status: string; paymentStatus: string }>): Promise<void> {
    await this.post(`/api/orders/${id}/status`, body, 'Order updated.');
  }

  protected async updateUserStatus(id: string, status: UserStatus): Promise<void> {
    await this.post(`/api/users/${id}/status`, { status }, `User marked ${status}.`);
  }

  protected async updateVendor(id: string, body: Partial<{ status: VendorStatus; registrationStatus: RegistrationStatus }>): Promise<void> {
    await this.post(`/api/vendors/${id}/status`, body, 'Vendor updated.');
  }

  protected async updateRegistration(id: string, status: string): Promise<void> {
    await this.post(`/api/compliance/registration-requests/${id}`, { status, notes: `Marked ${status} by admin.` }, 'Registration request updated.');
  }

  protected async reviewDocument(id: string, status: string): Promise<void> {
    await this.post(`/api/vendor-documents/${id}/review`, { status }, 'Document review saved.');
  }

  protected documentName(documentRecord: any): string {
    const fileUrl = String(documentRecord.fileUrl || '');
    return fileUrl.split('/').pop() || fileUrl || 'Uploaded file';
  }

  protected async downloadDocument(documentRecord: any): Promise<void> {
    try {
      if (/^https?:\/\//i.test(String(documentRecord.fileUrl || ''))) {
        window.open(documentRecord.fileUrl, '_blank', 'noopener');
        return;
      }
      const response = await fetch(apiUrl(`/api/vendor-documents/${documentRecord.id}/download`), {
        headers: this.auth.authHeaders()
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Document download failed.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = this.documentName(documentRecord);
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Document download failed.');
    }
  }

  protected async updateCheckoutRequest(id: string, status: string): Promise<void> {
    await this.post(`/api/vendor-wallets/checkout-requests/${id}/status`, { status }, `Checkout request marked ${status}.`);
  }

  protected async confirmPaymentSession(id: string): Promise<void> {
    await this.post(`/api/payments/sessions/${id}/mock-pay`, {}, 'Payment session confirmed.');
  }

  protected async repairWalletAudit(vendorId: string): Promise<void> {
    await this.post(`/api/vendor-wallets/${vendorId}/audit/repair`, {}, 'Wallet audit repair completed.');
  }

  protected async flagOrderDispute(order: AdminOrder): Promise<void> {
    await this.post(`/api/orders/${order.orderId}/dispute`, {
      vendorId: order.vendorId,
      reason: 'late_receipt_confirmation',
      notes: `Admin flagged order after ${order.daysWaitingForReceipt || 0} day(s) waiting for customer receipt confirmation.`
    }, 'Order dispute flag created.');
  }

  protected async flagServiceBookingDispute(booking: AdminServiceBooking): Promise<void> {
    await this.post(`/api/bookings/${booking.id}/dispute`, {
      reason: 'late_completion',
      notes: 'Admin flagged service booking while waiting for customer completion confirmation.'
    }, 'Service booking dispute flag created.');
  }

  protected async inspectVendorLedger(vendorId: string): Promise<void> {
    try {
      const response = await fetch(apiUrl(`/api/vendor-wallets/${vendorId}/ledger`), {
        headers: this.auth.authHeaders()
      });
      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(payload.error || 'Vendor ledger could not be loaded.');
      }
      this.selectedLedgerVendorId.set(vendorId);
      this.selectedLedgerEntries.set(payload as WalletLedgerEntry[]);
      this.message.set(`Ledger loaded for ${this.vendorName(vendorId)}.`);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Vendor ledger could not be loaded.');
    }
  }

  protected async exportVendorLedger(vendorId: string): Promise<void> {
    try {
      const response = await fetch(apiUrl(`/api/vendor-wallets/${vendorId}/ledger.csv`), {
        headers: this.auth.authHeaders()
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Ledger export failed.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.vendorName(vendorId)}-market-credits-ledger.csv`.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
      link.click();
      URL.revokeObjectURL(url);
      this.message.set(`Ledger exported for ${this.vendorName(vendorId)}.`);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Ledger export failed.');
    }
  }

  protected auditDetails(log: AdminAuditLogRow): string {
    if (!log.details) return 'No details';
    try {
      return JSON.stringify(log.details);
    } catch {
      return String(log.details);
    }
  }

  private matches(fields: Array<string | number | undefined | null>): boolean {
    const term = this.search.trim().toLowerCase();
    if (!term) return true;
    return fields.some((field) => String(field ?? '').toLowerCase().includes(term));
  }

  private matchesStatus(...statuses: string[]): boolean {
    return this.statusFilter === 'all' || statuses.includes(this.statusFilter);
  }

  private async post(path: string, body: unknown, successMessage: string): Promise<void> {
    try {
      const response = await fetch(apiUrl(path), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Request failed.');
      }
      this.message.set(successMessage);
      await this.loadOperations();
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Request failed.');
    }
  }
}
