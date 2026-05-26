import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { SubscriptionService } from './subscription.service';
import { SubscriptionPlan, formatCurrency, hasDiscountPrice } from './market-data';

type VendorTab = 'overview' | 'wallet' | 'store' | 'orders' | 'listings' | 'services' | 'customers' | 'discounts' | 'documents' | 'subscriptions';

interface VendorStore {
  id: string;
  vendorId: string;
  name: string;
  slug: string;
  summary: string;
  location: string;
  addressLine1?: string;
  addressLine2?: string;
  parish?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  status: string;
}

interface VendorRecord {
  id: string;
  name: string;
  slug: string;
  summary: string;
  registrationStatus: string;
  onboardedAt: string;
  subscriptionStatus: string;
  subscriptionPlan: string;
  nextBillingAt?: string;
}

@Component({
  selector: 'app-vendor-dashboard-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Vendor workspace</p>
          <h1>Manage your store, catalog, customers, and subscription</h1>
          <p>Run day-to-day marketplace work from one private dashboard.</p>
        </div>
      </section>

      <section class="container section">
        @if (!auth.currentUser()) {
          <div class="notice error">
            <strong>Sign in required</strong>
            <p>Vendor tools are private. Sign in to manage your store.</p>
            <a class="button primary-button" routerLink="/login">Sign in</a>
          </div>
        }

        @if (operations(); as data) {
          @if ((data.vendors?.length ?? 0) > 0) {
            <div class="vendor-console-header">
              <div>
                <p class="eyebrow">Active store</p>
                <h2>{{ activeVendor()?.name }}</h2>
                <p>{{ activeVendor()?.summary || 'Store profile summary has not been added yet.' }}</p>
              </div>
              <div class="vendor-switcher">
                <label>
                  Store
                  <select [(ngModel)]="selectedVendorId" (ngModelChange)="selectVendor($event)">
                    @for (vendor of data.vendors; track vendor.id) {
                      <option [value]="vendor.id">{{ vendor.name }}</option>
                    }
                  </select>
                </label>
                @if (activeStore()?.slug && canPublish(activeVendor())) {
                  <a class="button secondary-button" [routerLink]="['/vendor', activeStore()?.slug]">View public store</a>
                } @else if (activeStore()?.slug) {
                  <span class="action-note">Public store opens after registration</span>
                }
              </div>
            </div>

            <div class="vendor-kpis">
              <article><span>Published listings</span><strong>{{ publishedProductCount() }}</strong></article>
              <article><span>Stock units</span><strong>{{ stockTotal() }}</strong></article>
              <article><span>Open orders</span><strong>{{ pendingOrderCount() }}</strong></article>
              <article><span>Available credits</span><strong>{{ activeWallet()?.availableCoins ?? 0 }}</strong></article>
              <article><span>Held credits</span><strong>{{ activeWallet()?.heldCoins ?? 0 }}</strong></article>
              <article><span>Active carts</span><strong>{{ customerCartCount() }}</strong></article>
              <article><span>Active discounts</span><strong>{{ activeDiscountCount() }}</strong></article>
              <article><span>Documents pending</span><strong>{{ pendingDocumentCount() }}</strong></article>
            </div>

            <div class="admin-toolbar vendor-toolbar">
              <div class="admin-tabs" role="tablist" aria-label="Vendor sections">
                @for (tab of tabs; track tab.value) {
                  <button type="button" [class.active]="activeTab() === tab.value" (click)="activeTab.set(tab.value)">
                    {{ tab.label }}
                  </button>
                }
              </div>
              <div class="admin-tools">
                <button class="button-sm" type="button" (click)="loadOperations()">Refresh</button>
              </div>
            </div>

            @if (activeTab() === 'overview') {
              <section class="vendor-panel">
                <div class="vendor-overview-grid">
                  <article class="dashboard-card">
                    <h3>Readiness</h3>
                    <div class="stats-list">
                      <div><strong>{{ activeVendor()?.subscriptionPlan }}</strong><span>{{ activeVendor()?.subscriptionStatus }} subscription</span></div>
                      <div><strong>{{ activeVendor()?.nextBillingAt || 'Not scheduled' }}</strong><span>Next billing date</span></div>
                      <div><strong>{{ activeVendor()?.registrationStatus }}</strong><span>Business registration</span></div>
                      <div><strong>{{ canPublish(activeVendor()) ? 'Enabled' : 'Paused' }}</strong><span>Publishing</span></div>
                    </div>
                    <div class="notice" [class.error]="severity(activeVendor()) === 'critical'">
                      <strong>Compliance status</strong>
                      <p>{{ compliance(activeVendor()) }}</p>
                    </div>
                    @if (activeVendor()?.registrationStatus === 'unregistered') {
                      <button class="button primary-button" type="button" (click)="requestAssistance()">Request registration assistance</button>
                    }
                  </article>

                  <article class="dashboard-card">
                    <h3>Market Credits</h3>
                    <div class="stats-list">
                      <div><strong>{{ activeWallet()?.availableCoins ?? 0 }}</strong><span>Available for subscriptions, featuring, or checkout</span></div>
                      <div><strong>{{ activeWallet()?.heldCoins ?? 0 }}</strong><span>Held until fulfillment and customer receipt confirmation</span></div>
                      <div><strong>{{ activeWallet()?.pendingCheckoutCoins ?? 0 }}</strong><span>Pending owner payout</span></div>
                    </div>
                    <button class="button secondary-button" type="button" (click)="activeTab.set('wallet')">Manage credits</button>
                  </article>

                  <article class="dashboard-card">
                    <h3>Recent carts</h3>
                    @for (cart of vendorCartCustomers().slice(0, 4); track cart.cartId + cart.vendorId) {
                      <p><strong>{{ cart.cartLabel }}</strong><br>{{ cart.itemCount }} items - {{ money(cart.cartTotal) }} - {{ cartAgeLabel(cart.ageHours) }}</p>
                    } @empty {
                      <p>No active carts currently have your items.</p>
                    }
                  </article>

                  <article class="dashboard-card">
                    <h3>Notifications</h3>
                    @for (notification of vendorNotifications().slice(0, 4); track notification.id) {
                      <p><strong>{{ notification.title }}</strong><br>{{ notification.message }}</p>
                    } @empty {
                      <p>No compliance reminders right now.</p>
                    }
                  </article>
                </div>
              </section>
            }

            @if (activeTab() === 'wallet') {
              <section class="vendor-panel wallet-panel">
                <div class="admin-panel-header">
                  <div>
                    <h2>Market Credits Wallet</h2>
                    <p>Track available credits, held order funds, checkout requests, and payout details.</p>
                  </div>
                  <button class="button secondary-button" type="button" (click)="exportLedger()">Export ledger</button>
                </div>

                <div class="wallet-breakdown-grid">
                  <article><strong>{{ activeWallet()?.availableCoins ?? 0 }}</strong><span>Available credits</span><p>Ready for subscriptions, featuring, or checkout.</p></article>
                  <article><strong>{{ activeWallet()?.heldCoins ?? 0 }}</strong><span>Held credits</span><p>Paid order funds waiting for fulfillment and customer receipt.</p></article>
                  <article><strong>{{ activeWallet()?.pendingCheckoutCoins ?? 0 }}</strong><span>Pending checkout</span><p>Credits already requested and waiting for owner payout.</p></article>
                  <article><strong>{{ activeWallet()?.lifetimeEarnedCoins ?? 0 }}</strong><span>Lifetime earned</span><p>Total paid order credits generated for this store.</p></article>
                </div>

                <div class="notice">
                  <strong>Checkout reserve</strong>
                  <p>{{ activeWallet()?.checkoutRecommendation || 'Keep enough credits for your next subscription before requesting a full checkout.' }}</p>
                </div>

                <div class="wallet-operations-grid">
                  <form class="profile-form" (ngSubmit)="savePayoutProfile()">
                    <h2>Payout details</h2>
                    <label>Payout method <input name="savedPayoutMethod" [(ngModel)]="payoutForm.payoutMethod" placeholder="Bank transfer, mobile wallet, cash pickup"></label>
                    <label>Payout instructions <textarea name="savedPayoutDetails" rows="4" [(ngModel)]="payoutForm.payoutDetails" placeholder="Account name, bank, branch, wallet number, or pickup notes"></textarea></label>
                    <button class="button secondary-button" type="submit">Save payout details</button>
                  </form>

                  <form class="profile-form" (ngSubmit)="requestCheckout()">
                    <h2>Request checkout</h2>
                    <label>Amount in credits <input name="checkoutAmount" type="number" min="1" [(ngModel)]="checkoutForm.amountCoins" required></label>
                    <label>Payout method <input name="payoutMethod" [(ngModel)]="checkoutForm.payoutMethod" placeholder="Bank transfer, mobile wallet, cash pickup"></label>
                    <label>Payout details <textarea name="payoutDetails" rows="4" [(ngModel)]="checkoutForm.payoutDetails" placeholder="Account name, bank, branch, wallet number, or pickup notes"></textarea></label>
                    <div class="action-cell">
                      <button class="button outline-button" type="button" (click)="useSavedPayoutDetails()">Use saved details</button>
                      <button class="button primary-button" type="submit">Request checkout</button>
                    </div>
                  </form>
                </div>

                <div class="split-grid wallet-order-grid">
                  <article class="dashboard-card">
                    <h2>Orders holding funds</h2>
                    @for (order of heldFundOrders(); track order.orderId + order.vendorId) {
                      <div class="fund-order-row">
                        <p><strong>{{ order.orderId }}</strong><br><span class="product-meta">{{ order.customerName }} - {{ order.createdAt }}</span></p>
                        <div><strong>{{ order.heldCredits }} credits held</strong><span class="status-pill" [class.warn]="order.fundStatus !== 'released'">{{ order.fundStatus }}</span></div>
                      </div>
                    } @empty {
                      <p>No paid orders are currently holding credits.</p>
                    }
                  </article>

                  <article class="dashboard-card">
                    <h2>Orders with released funds</h2>
                    @for (order of releasedFundOrders(); track order.orderId + order.vendorId) {
                      <div class="fund-order-row">
                        <p><strong>{{ order.orderId }}</strong><br><span class="product-meta">{{ order.customerName }} - {{ order.createdAt }}</span></p>
                        <div><strong>{{ order.releasedCredits }} credits released</strong><span class="status-pill">released</span></div>
                      </div>
                    } @empty {
                      <p>No orders have released credits yet.</p>
                    }
                  </article>
                </div>

                <div class="split-grid wallet-order-grid">
                  <article class="dashboard-card">
                    <h2>Service bookings holding funds</h2>
                    @for (booking of heldServiceBookings(); track booking.id) {
                      <div class="fund-order-row">
                        <p><strong>{{ booking.serviceName }}</strong><br><span class="product-meta">{{ booking.customerName }} - {{ booking.bookedAt }}</span></p>
                        <div><strong>{{ booking.heldCredits }} credits held</strong><span class="status-pill" [class.warn]="booking.fundStatus !== 'released'">{{ booking.fundStatus }}</span></div>
                      </div>
                    } @empty {
                      <p>No paid service bookings are currently holding credits.</p>
                    }
                  </article>

                  <article class="dashboard-card">
                    <h2>Service bookings with released funds</h2>
                    @for (booking of releasedServiceBookings(); track booking.id) {
                      <div class="fund-order-row">
                        <p><strong>{{ booking.serviceName }}</strong><br><span class="product-meta">{{ booking.customerName }} - {{ booking.bookedAt }}</span></p>
                        <div><strong>{{ booking.releasedCredits }} credits released</strong><span class="status-pill">released</span></div>
                      </div>
                    } @empty {
                      <p>No service booking credits have been released yet.</p>
                    }
                  </article>
                </div>

                <div class="split-grid">
                  <article class="dashboard-card">
                    <h2>Checkout requests</h2>
                    @for (request of vendorCheckoutRequests(); track request.id) {
                      <div class="checkout-request-row">
                        <p><strong>{{ request.amountCoins }} credits</strong><br>{{ request.status }} - {{ request.createdAt }}</p>
                        <button class="button-sm" type="button" (click)="selectCheckoutRequest(request)">View details</button>
                      </div>
                    } @empty {
                      <p>No checkout requests yet.</p>
                    }
                  </article>

                  <article class="dashboard-card">
                    <h2>Checkout request detail</h2>
                    @if (selectedCheckoutRequest(); as request) {
                      <div class="detail-list">
                        <div><span>Request</span><strong>{{ request.id }}</strong></div>
                        <div><span>Status</span><strong>{{ request.status }}</strong></div>
                        <div><span>Amount</span><strong>{{ request.amountCoins }} credits</strong></div>
                        <div><span>Payout method</span><strong>{{ request.payoutMethod || 'Not provided' }}</strong></div>
                        <div><span>Payout details</span><strong>{{ request.payoutDetails || 'Not provided' }}</strong></div>
                        <div><span>Created</span><strong>{{ request.createdAt }}</strong></div>
                        <div><span>Updated</span><strong>{{ request.updatedAt }}</strong></div>
                      </div>
                      <p class="product-meta">{{ request.advisoryMessage }}</p>
                    } @else {
                      <p>Select a checkout request to view the payout details and advisory note.</p>
                    }
                  </article>
                </div>

                <article class="dashboard-card wallet-ledger-card">
                  <h2>Recent ledger</h2>
                  @for (entry of vendorWalletLedger().slice(0, 12); track entry.id) {
                    <div class="ledger-row">
                      <strong>{{ entry.direction === 'credit' ? '+' : '-' }}{{ entry.amountCoins }} credits</strong>
                      <span>{{ entry.entryType }} - {{ entry.balanceBucket }} - {{ entry.createdAt }}</span>
                      <p>{{ entry.description }}</p>
                    </div>
                  } @empty {
                    <p>No credit activity yet.</p>
                  }
                </article>
              </section>
            }

            @if (activeTab() === 'orders') {
              <section class="vendor-panel">
                <div class="admin-panel-header">
                  <div>
                    <h2>Order History</h2>
                    <p>Review paid and confirmed orders containing items from this store.</p>
                  </div>
                </div>
                <div class="table-wrap">
                  <table class="admin-table">
                    <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th>Credits</th><th>Actions</th></tr></thead>
                    <tbody>
                      @for (order of vendorOrders(); track order.orderId + order.vendorId) {
                        <tr>
                          <td><strong>{{ order.orderId }}</strong><br><span class="product-meta">{{ order.createdAt }}</span></td>
                          <td>{{ order.customerName }}<br><span class="product-meta">{{ order.customerContact }}</span></td>
                          <td>{{ order.productCount }} products / {{ order.itemCount }} units</td>
                          <td>{{ money(order.vendorTotal) }}</td>
                          <td>
                            <span class="status-pill" [class.warn]="order.paymentStatus !== 'paid'">{{ order.paymentSessionStatus || order.paymentStatus }}</span><br>
                            <span class="product-meta">{{ order.paymentSessionId || 'No session' }}</span>
                          </td>
                          <td><span class="status-pill" [class.warn]="order.fulfillmentStatus !== 'fulfilled'">{{ order.fulfillmentStatus }}</span></td>
                          <td>
                            <span class="status-pill" [class.warn]="order.fundStatus !== 'released'">{{ order.fundStatus }}</span><br>
                            <span class="product-meta">{{ order.heldCredits }} held / {{ order.releasedCredits }} released</span>
                            @if (order.isReceiptLate) {
                              <br><span class="product-meta">Receipt confirmation overdue</span>
                            }
                            @if (order.hasOpenDispute) {
                              <br><span class="product-meta">Customer/admin issue open</span>
                            }
                          </td>
                          <td class="action-cell">
                            @if (order.paymentStatus !== 'paid') {
                              <span class="action-note">Awaiting payment</span>
                            } @else if (order.hasOpenDispute) {
                              <span class="action-note">Issue open</span>
                            } @else {
                              <button class="button-sm" type="button" [disabled]="order.fulfillmentStatus === 'preparing'" (click)="updateOrderFulfillment(order, 'preparing')">Preparing</button>
                              <button class="button-sm" type="button" [disabled]="order.fulfillmentStatus === 'ready_for_pickup'" (click)="updateOrderFulfillment(order, 'ready_for_pickup')">Ready pickup</button>
                              <button class="button-sm" type="button" [disabled]="order.fulfillmentStatus === 'out_for_delivery'" (click)="updateOrderFulfillment(order, 'out_for_delivery')">Out delivery</button>
                              <button class="button-sm" type="button" [disabled]="order.fulfillmentStatus === 'fulfilled'" (click)="updateOrderFulfillment(order, 'fulfilled')">Fulfilled</button>
                            }
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="8">No orders have been placed for this store yet.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>

                <div class="admin-panel-header service-booking-header">
                  <div>
                    <h2>Service bookings</h2>
                    <p>Start paid bookings, mark completed work, and track held credits.</p>
                  </div>
                </div>
                <div class="table-wrap">
                  <table class="admin-table">
                    <thead><tr><th>Booking</th><th>Customer</th><th>Payment</th><th>Status</th><th>Credits</th><th>Actions</th></tr></thead>
                    <tbody>
                      @for (booking of vendorServiceBookings(); track booking.id) {
                        <tr>
                          <td><strong>{{ booking.serviceName }}</strong><br><span class="product-meta">{{ booking.date }} at {{ booking.time }}</span></td>
                          <td>{{ booking.customerName }}<br><span class="product-meta">{{ booking.customerContact }}</span></td>
                          <td>
                            <span class="status-pill" [class.warn]="booking.paymentStatus !== 'paid'">{{ booking.paymentSessionStatus || booking.paymentStatus }}</span><br>
                            <span class="product-meta">{{ booking.paymentSessionId || 'No session' }}</span>
                          </td>
                          <td><span class="status-pill" [class.warn]="booking.status !== 'customer_confirmed'">{{ booking.status }}</span></td>
                          <td>
                            <span class="status-pill" [class.warn]="booking.fundStatus !== 'released'">{{ booking.fundStatus }}</span><br>
                            <span class="product-meta">{{ booking.heldCredits }} held / {{ booking.releasedCredits }} released</span>
                            @if (booking.hasOpenDispute) {
                              <br><span class="product-meta">Customer/admin issue open</span>
                            }
                          </td>
                          <td class="action-cell">
                            @if (booking.paymentStatus !== 'paid') {
                              <span class="action-note">Awaiting payment</span>
                            } @else if (booking.hasOpenDispute) {
                              <span class="action-note">Issue open</span>
                            } @else {
                              <button class="button-sm" type="button" [disabled]="booking.status === 'in_progress' || booking.status === 'completed' || booking.status === 'customer_confirmed'" (click)="updateServiceBookingStatus(booking, 'in_progress')">Start</button>
                              <button class="button-sm" type="button" [disabled]="booking.status === 'completed' || booking.status === 'customer_confirmed'" (click)="updateServiceBookingStatus(booking, 'completed')">Completed</button>
                              @if (booking.status === 'completed' && !booking.customerConfirmedAt) {
                                <span class="action-note">Waiting customer</span>
                              }
                            }
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="6">No service bookings yet.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @if (activeTab() === 'store') {
              <section class="vendor-panel split-grid">
                <form class="profile-form" (ngSubmit)="saveStore()">
                  <h2>Store Profile</h2>
                  <label>Store name <input name="storeName" [(ngModel)]="storeForm.name" required></label>
                  <label>Public URL slug <input name="storeSlug" [(ngModel)]="storeForm.slug" required></label>
                  <label>Location label <input name="storeLocation" [(ngModel)]="storeForm.location" placeholder="Half Way Tree, Portmore, Spanish Town"></label>
                  <label>Street or pickup address <input name="storeAddressLine1" [(ngModel)]="storeForm.addressLine1" placeholder="Street, plaza, shop number, or pickup point"></label>
                  <label>Address line 2 <input name="storeAddressLine2" [(ngModel)]="storeForm.addressLine2" placeholder="Suite, unit, landmark"></label>
                  <label>Parish <input name="storeParish" [(ngModel)]="storeForm.parish" placeholder="Kingston, St. Catherine, St. Andrew"></label>
                  <div class="form-grid compact-form">
                    <label>Latitude <input name="storeLatitude" type="number" step="any" [(ngModel)]="storeForm.latitude" placeholder="18.0125"></label>
                    <label>Longitude <input name="storeLongitude" type="number" step="any" [(ngModel)]="storeForm.longitude" placeholder="-76.7981"></label>
                  </div>
                  <button class="button outline-button" type="button" (click)="useCurrentLocationForStore()">Use current location for map</button>
                  <label>Status <select name="storeStatus" [(ngModel)]="storeForm.status"><option>draft</option><option>active</option><option>paused</option></select></label>
                  <label>Summary <textarea name="storeSummary" [(ngModel)]="storeForm.summary" rows="4" placeholder="Tell customers what your store offers"></textarea></label>
                  <button class="button primary-button" type="submit">Save store</button>
                </form>

                <article class="dashboard-card">
                  <h2>Share Tools</h2>
                  @if (activeStore()?.slug) {
                    <p>{{ storeUrl() }}</p>
                    <div class="share-actions">
                      <button class="button secondary-button" type="button" (click)="copyStoreLink()">{{ copyLabel() }}</button>
                      <a class="button outline-button" [href]="whatsappShare()" target="_blank" rel="noopener">WhatsApp</a>
                      <a class="button outline-button" [href]="facebookShare()" target="_blank" rel="noopener">Facebook</a>
                    </div>
                  }
                  <h3>Store media</h3>
                  <form class="profile-form compact-form" (ngSubmit)="addMedia()">
                    <label>Media URL <input name="mediaUrl" [(ngModel)]="mediaForm.url" placeholder="https://..."></label>
                    <label>Media type <select name="mediaType" [(ngModel)]="mediaForm.mediaType"><option>logo</option><option>banner</option><option>gallery</option></select></label>
                    <button class="button secondary-button" type="submit">Add media</button>
                  </form>
                </article>
              </section>
            }

            @if (activeTab() === 'listings') {
              <section class="vendor-panel">
                <div class="admin-panel-header">
                  <div>
                    <h2>Products and Food</h2>
                    <p>Create listings, publish or pause items, and update stock quantity.</p>
                  </div>
                </div>
                <form class="profile-form wide-form" (ngSubmit)="createListing()">
                  @if (!canPublish(activeVendor())) {
                    <div class="notice">
                      <strong>Registration required before public listing</strong>
                      <p>You can save drafts now. Products and foods will not be published or shown in the marketplace until this business is registered.</p>
                    </div>
                  }
                  <div class="form-grid">
                    <label>Type <select name="productType" [(ngModel)]="listingForm.type"><option value="product">Product</option><option value="food">Food</option></select></label>
                    <label>Name <input name="productName" [(ngModel)]="listingForm.name" required></label>
                    <label>Price JMD <input name="productPrice" type="number" [(ngModel)]="listingForm.price" placeholder="Enter amount in JMD" required></label>
                    <label>Stock quantity <input name="productStockQuantity" type="number" min="0" [(ngModel)]="listingForm.stockQuantity" placeholder="Available quantity"></label>
                    <label>Delivery day <input name="deliveryDay" [(ngModel)]="listingForm.deliveryDay" placeholder="Mon, Wed, pickup, etc."></label>
                    <label>Status <select name="productStatus" [(ngModel)]="listingForm.status"><option>draft</option><option [disabled]="!canPublish(activeVendor())">published</option></select></label>
                  </div>
                  <label>Description <textarea name="productDescription" [(ngModel)]="listingForm.description" rows="3" placeholder="Describe the item"></textarea></label>
                  <button class="button primary-button" type="submit">Create listing</button>
                </form>

                <div class="table-wrap">
                  <table class="admin-table">
                    <thead><tr><th>Listing</th><th>Type</th><th>Price</th><th>Stock</th><th>Discounts</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      @for (product of vendorProducts(); track product.id) {
                        <tr>
                          <td><strong>{{ product.name }}</strong><br><span class="product-meta">{{ product.description || 'No description' }}</span></td>
                          <td>{{ product.type }}</td>
                          <td>
                            <div class="price-block">
                              @if (hasDiscount(product)) {
                                <span class="old-price">{{ money(product.originalPrice ?? product.price) }}</span>
                              }
                              <strong [class.discount-price]="hasDiscount(product)">{{ money(product.price) }}</strong>
                              @if (hasDiscount(product)) {
                                <span class="discount-badge">{{ listingDiscountLabel(product) }}</span>
                              }
                            </div>
                          </td>
                          <td><input class="table-input" type="number" min="0" [(ngModel)]="product.stockQuantity" [name]="'stock' + product.id"></td>
                          <td class="discount-cell">
                            <span class="product-meta">{{ product.discountNames || 'No discount applied' }}</span>
                            <select [(ngModel)]="selectedDiscountForProduct[product.id]" [name]="'discount' + product.id">
                              <option value="">Select discount</option>
                              @for (discount of activeDiscounts(); track discount.id) {
                                <option [value]="discount.id">{{ discount.name }}</option>
                              }
                            </select>
                            <button class="button-sm" type="button" (click)="applyDiscountToProduct(product)">Apply</button>
                            @for (discountId of discountIdsForProduct(product); track discountId) {
                              <button class="button-sm danger" type="button" (click)="removeDiscountFromProduct(product, discountId)">Remove</button>
                            }
                          </td>
                          <td><span class="status-pill" [class.warn]="product.status !== 'published'">{{ product.status }}</span></td>
                          <td class="action-cell">
                            <button class="button-sm" type="button" (click)="updateStock(product)">Save stock</button>
                            @if (product.status === 'published') {
                              <button class="button-sm danger" type="button" (click)="updateProductStatus(product, 'paused')">Pause</button>
                            } @else {
                              <button class="button-sm" type="button" [disabled]="!canPublish(activeVendor())" (click)="updateProductStatus(product, 'published')">Publish</button>
                            }
                            @if (product.isFeatured) {
                              <span class="action-note">Featured</span>
                            } @else {
                              <button class="button-sm" type="button" [disabled]="!canPublish(activeVendor())" (click)="featureProduct(product)">Feature</button>
                            }
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="7">No listings yet.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @if (activeTab() === 'services') {
              <section class="vendor-panel">
                <div class="admin-panel-header">
                  <div>
                    <h2>Services</h2>
                    <p>Create, publish, or pause bookable services.</p>
                  </div>
                </div>
                <form class="profile-form wide-form" (ngSubmit)="createService()">
                  @if (!canPublish(activeVendor())) {
                    <div class="notice">
                      <strong>Registration required before public service booking</strong>
                      <p>You can save service drafts now. Services will not be published or bookable until this business is registered.</p>
                    </div>
                  }
                  <div class="form-grid">
                    <label>Name <input name="serviceName" [(ngModel)]="serviceForm.name" required></label>
                    <label>Category <input name="serviceCategory" [(ngModel)]="serviceForm.category" placeholder="Delivery, home care, personal service" required></label>
                    <label>Price JMD <input name="servicePrice" type="number" [(ngModel)]="serviceForm.price" placeholder="Enter amount in JMD" required></label>
                    <label>Pricing type <input name="pricingType" [(ngModel)]="serviceForm.pricingType" placeholder="Fixed or Hourly"></label>
                    <label>Status <select name="serviceStatus" [(ngModel)]="serviceForm.status"><option>draft</option><option [disabled]="!canPublish(activeVendor())">published</option></select></label>
                  </div>
                  <label>Description <textarea name="serviceDescription" [(ngModel)]="serviceForm.description" rows="3" placeholder="Describe the service"></textarea></label>
                  <button class="button primary-button" type="submit">Create service</button>
                </form>

                <div class="table-wrap">
                  <table class="admin-table">
                    <thead><tr><th>Service</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      @for (service of vendorServices(); track service.id) {
                        <tr>
                          <td><strong>{{ service.name }}</strong><br><span class="product-meta">{{ service.description || 'No description' }}</span></td>
                          <td>{{ service.category }}</td>
                          <td>{{ money(service.price) }} {{ service.pricingType }}</td>
                          <td><span class="status-pill" [class.warn]="service.status !== 'published'">{{ service.status }}</span></td>
                          <td class="action-cell">
                            @if (service.status === 'published') {
                              <button class="button-sm danger" type="button" (click)="updateServiceStatus(service, 'paused')">Pause</button>
                            } @else {
                              <button class="button-sm" type="button" [disabled]="!canPublish(activeVendor())" (click)="updateServiceStatus(service, 'published')">Publish</button>
                            }
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="5">No services yet.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @if (activeTab() === 'customers') {
              <section class="vendor-panel">
                <div class="admin-panel-header">
                  <div>
                    <h2>Carts With Your Items</h2>
                    <p>Offer an existing discount to carts that have been sitting for a while.</p>
                  </div>
                </div>
                <div class="table-wrap">
                  <table class="admin-table">
                    <thead><tr><th>Cart</th><th>Products</th><th>Items</th><th>Cart total</th><th>Age</th><th>Offer</th></tr></thead>
                    <tbody>
                      @for (cart of vendorCartCustomers(); track cart.cartId + cart.vendorId) {
                        <tr>
                          <td>{{ cart.cartLabel }}<br><span class="product-meta">{{ cart.activeOfferCount || 0 }} active offers</span></td>
                          <td>{{ cart.productCount }}<br><span class="product-meta">{{ cart.productNames }}</span></td>
                          <td>{{ cart.itemCount }}</td>
                          <td>{{ money(cart.cartTotal) }}</td>
                          <td>{{ cartAgeLabel(cart.ageHours) }}</td>
                          <td class="action-cell">
                            <select [(ngModel)]="selectedDiscountForCart[cart.cartId]" [name]="'cartDiscount' + cart.cartId">
                              <option value="">Select discount</option>
                              @for (discount of activeDiscounts(); track discount.id) {
                                <option [value]="discount.id">{{ discount.name }}</option>
                              }
                            </select>
                            <button class="button-sm" type="button" (click)="offerDiscountToCart(cart)">Offer</button>
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="6">No active carts currently contain your items.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @if (activeTab() === 'discounts') {
              <section class="vendor-panel split-grid">
                <form class="profile-form" (ngSubmit)="createDiscount()">
                  <h2>Discount Library</h2>
                  <label>Offer name <input name="discountName" [(ngModel)]="discountForm.name" required></label>
                  <label>Code <input name="discountCode" [(ngModel)]="discountForm.code" placeholder="Optional public code"></label>
                  <label>Type <select name="discountType" [(ngModel)]="discountForm.discountType"><option value="percent">Percent</option><option value="fixed">Fixed JMD</option></select></label>
                  <label>Amount <input name="discountAmount" type="number" min="1" [(ngModel)]="discountForm.amount" placeholder="Percent or JMD amount" required></label>
                  <button class="button primary-button" type="submit">Create discount</button>
                </form>

                <article class="dashboard-card">
                  <h2>Current discounts</h2>
                  @for (discount of vendorDiscounts(); track discount.id) {
                    <div class="discount-row">
                      <p><strong>{{ discount.name }}</strong><br>{{ discountLabel(discount) }} - {{ discount.status }}<br><span class="product-meta">{{ discount.appliedProductCount || 0 }} products, {{ discount.activeCartOfferCount || 0 }} cart offers</span></p>
                      <div class="action-cell">
                        @if (discount.status === 'active') {
                          <button class="button-sm" type="button" (click)="updateDiscountStatus(discount, 'paused')">Disable</button>
                        } @else {
                          <button class="button-sm" type="button" (click)="updateDiscountStatus(discount, 'active')">Enable</button>
                        }
                        <button class="button-sm danger" type="button" (click)="deleteDiscount(discount)">Delete</button>
                      </div>
                    </div>
                  } @empty {
                    <p>No discounts created yet.</p>
                  }
                </article>
              </section>
            }

            @if (activeTab() === 'documents') {
              <section class="vendor-panel split-grid">
                <form class="profile-form" (ngSubmit)="uploadDocument()">
                  <h2>Registration Documents</h2>
                  <label>Document type <input name="documentType" [(ngModel)]="documentForm.documentType" placeholder="Business registration document"></label>
                  <label>Document URL <input name="documentUrl" [(ngModel)]="documentForm.fileUrl" placeholder="https://..."></label>
                  <button class="button primary-button" type="submit">Upload document</button>
                </form>

                <article class="dashboard-card">
                  <h2>Uploaded documents</h2>
                  @for (document of vendorDocuments(); track document.id) {
                    <p><strong>{{ document.documentType }}</strong><br>{{ document.status }} - {{ document.fileUrl }}</p>
                  } @empty {
                    <p>No documents uploaded yet.</p>
                  }
                </article>
              </section>
            }

            @if (activeTab() === 'subscriptions') {
              <section class="vendor-panel">
                <div class="admin-panel-header">
                  <div>
                    <h2>Subscription Plans</h2>
                    <p>Choose a plan for {{ activeVendor()?.name }}. Paid plans activate automatically after payment confirmation.</p>
                  </div>
                </div>
                <div class="subscription-plans vendor-plan-grid">
                  @for (plan of plans(); track plan.id) {
                    <div class="plan-row">
                      <div>
                        <strong>{{ plan.name }}</strong>
                        <span>{{ money(plan.monthlyPrice) }}/month - {{ plan.productLimit }} products</span>
                      </div>
                      <div class="action-cell">
                        <button class="button-sm" type="button" (click)="startCheckout(plan.id)">Pay external</button>
                        <button class="button-sm" type="button" [disabled]="!canPayPlanWithCredits(plan)" (click)="payPlanWithCredits(plan.id)">Use credits</button>
                      </div>
                    </div>
                  }
                </div>
              </section>
            }
          } @else {
            <article class="dashboard-card">
              <h2>No vendor store found</h2>
              <p>This account is signed in, but no vendor store is linked to it yet.</p>
            </article>
          }
        } @else {
          <article class="dashboard-card">
            <h2>Loading vendor workspace</h2>
            <p>Fetching your store, listings, customers, and compliance records.</p>
          </article>
        }

        @if (message()) {
          <div class="notice vendor-message">{{ message() }}</div>
        }
      </section>
    </main>
  `
})
export class VendorDashboardPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly subscriptions = inject(SubscriptionService);
  protected readonly plans = signal<SubscriptionPlan[]>([]);
  protected readonly money = formatCurrency;
  protected readonly hasDiscount = hasDiscountPrice;
  protected readonly message = signal('');
  protected readonly operations = signal<any | null>(null);
  protected readonly activeTab = signal<VendorTab>('overview');
  protected selectedVendorId = '';
  protected readonly copyLabel = signal('Copy link');
  protected readonly selectedCheckoutRequestId = signal('');

  protected readonly tabs: Array<{ value: VendorTab; label: string }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'wallet', label: 'Credits' },
    { value: 'store', label: 'Store' },
    { value: 'orders', label: 'Orders' },
    { value: 'listings', label: 'Listings' },
    { value: 'services', label: 'Services' },
    { value: 'customers', label: 'Carts' },
    { value: 'discounts', label: 'Discounts' },
    { value: 'documents', label: 'Documents' },
    { value: 'subscriptions', label: 'Subscriptions' }
  ];

  protected readonly activeVendor = computed<VendorRecord | null>(() => {
    const vendors = this.operations()?.vendors ?? [];
    return vendors.find((vendor: VendorRecord) => vendor.id === this.selectedVendorId) ?? vendors[0] ?? null;
  });

  protected readonly activeStore = computed<VendorStore | null>(() => {
    const vendorId = this.activeVendor()?.id;
    return (this.operations()?.stores ?? []).find((store: VendorStore) => store.vendorId === vendorId) ?? null;
  });

  protected readonly activeWallet = computed<any | null>(() => {
    const vendorId = this.activeVendor()?.id;
    return (this.operations()?.wallets ?? []).find((wallet: any) => wallet.vendorId === vendorId) ?? null;
  });

  protected readonly activePayoutProfile = computed<any | null>(() => {
    const vendorId = this.activeVendor()?.id;
    return (this.operations()?.payoutProfiles ?? []).find((profile: any) => profile.vendorId === vendorId) ?? null;
  });

  protected readonly selectedCheckoutRequest = computed<any | null>(() => {
    const requests = this.vendorCheckoutRequests();
    const selectedId = this.selectedCheckoutRequestId();
    return requests.find((request: any) => request.id === selectedId) ?? requests[0] ?? null;
  });

  protected storeForm = { name: '', slug: '', location: '', addressLine1: '', addressLine2: '', parish: '', latitude: null as number | null, longitude: null as number | null, status: 'draft', summary: '' };
  protected listingForm = { type: 'product', name: '', price: null as number | null, stockQuantity: null as number | null, deliveryDay: '', status: 'draft', description: '' };
  protected serviceForm = { name: '', category: '', price: null as number | null, pricingType: 'Fixed', status: 'draft', description: '' };
  protected mediaForm = { mediaType: 'gallery', url: '' };
  protected documentForm = { documentType: 'Business registration document', fileUrl: '' };
  protected discountForm = { name: '', code: '', discountType: 'percent', amount: null as number | null };
  protected payoutForm = { payoutMethod: 'bank_transfer', payoutDetails: '' };
  protected checkoutForm = { amountCoins: null as number | null, payoutMethod: 'bank_transfer', payoutDetails: '' };
  protected selectedDiscountForProduct: Record<string, string> = {};
  protected selectedDiscountForCart: Record<string, string> = {};

  ngOnInit(): void {
    void this.loadPlans();
    void this.loadOperations();
  }

  protected async loadPlans(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/subscriptions/plans'), { headers: this.auth.authHeaders() });
      if (response.ok) {
        this.plans.set(await response.json() as SubscriptionPlan[]);
      }
    } catch {
      this.message.set('Subscription plans API is unavailable.');
    }
  }

  protected async loadOperations(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/vendor/operations'), { headers: this.auth.authHeaders() });
      if (!response.ok) {
        this.message.set('Vendor operations could not be loaded.');
        return;
      }
      const data = await response.json();
      this.operations.set(data);
      const firstVendorId = this.selectedVendorId || data.vendors?.[0]?.id || '';
      if (firstVendorId) {
        this.selectVendor(firstVendorId);
      }
    } catch {
      this.message.set('Vendor operations API is unavailable.');
    }
  }

  protected selectVendor(vendorId: string): void {
    this.selectedVendorId = vendorId;
    const store = this.activeStore();
    if (store) {
      this.storeForm = {
        name: store.name,
        slug: store.slug,
        location: store.location,
        addressLine1: store.addressLine1 || '',
        addressLine2: store.addressLine2 || '',
        parish: store.parish || '',
        latitude: store.latitude === null || store.latitude === undefined ? null : Number(store.latitude),
        longitude: store.longitude === null || store.longitude === undefined ? null : Number(store.longitude),
        status: store.status,
        summary: store.summary
      };
    }
    this.mediaForm = { mediaType: 'gallery', url: '' };
    this.documentForm = { ...this.documentForm, fileUrl: '' };
    this.selectedCheckoutRequestId.set('');
    this.syncPayoutFormFromProfile();
  }

  protected vendorProducts(): any[] {
    return (this.operations()?.products ?? []).filter((product: any) => product.vendorId === this.selectedVendorId);
  }

  protected vendorServices(): any[] {
    return (this.operations()?.services ?? []).filter((service: any) => service.vendorId === this.selectedVendorId);
  }

  protected vendorServiceBookings(): any[] {
    return (this.operations()?.bookings ?? []).filter((booking: any) => booking.vendorId === this.selectedVendorId);
  }

  protected vendorDocuments(): any[] {
    return (this.operations()?.documents ?? []).filter((document: any) => document.vendorId === this.selectedVendorId);
  }

  protected vendorCartCustomers(): any[] {
    return (this.operations()?.cartCustomers ?? []).filter((cart: any) => cart.vendorId === this.selectedVendorId);
  }

  protected vendorOrders(): any[] {
    return (this.operations()?.orders ?? []).filter((order: any) => order.vendorId === this.selectedVendorId);
  }

  protected vendorWalletLedger(): any[] {
    return (this.operations()?.walletLedger ?? []).filter((entry: any) => entry.vendorId === this.selectedVendorId);
  }

  protected vendorCheckoutRequests(): any[] {
    return (this.operations()?.checkoutRequests ?? []).filter((request: any) => request.vendorId === this.selectedVendorId);
  }

  protected heldFundOrders(): any[] {
    return this.vendorOrders().filter((order: any) => Number(order.heldCredits || 0) > 0);
  }

  protected releasedFundOrders(): any[] {
    return this.vendorOrders().filter((order: any) => Number(order.releasedCredits || 0) > 0);
  }

  protected heldServiceBookings(): any[] {
    return this.vendorServiceBookings().filter((booking: any) => Number(booking.heldCredits || 0) > 0);
  }

  protected releasedServiceBookings(): any[] {
    return this.vendorServiceBookings().filter((booking: any) => Number(booking.releasedCredits || 0) > 0);
  }

  protected selectCheckoutRequest(request: any): void {
    this.selectedCheckoutRequestId.set(request.id);
  }

  protected vendorDiscounts(): any[] {
    return (this.operations()?.discounts ?? []).filter((discount: any) => discount.vendorId === this.selectedVendorId);
  }

  protected activeDiscounts(): any[] {
    return this.vendorDiscounts().filter((discount) => discount.status === 'active');
  }

  protected vendorNotifications(): any[] {
    return (this.operations()?.notifications ?? []).filter((notification: any) => !notification.vendorId || notification.vendorId === this.selectedVendorId);
  }

  protected publishedProductCount(): number {
    return this.vendorProducts().filter((product) => product.status === 'published').length;
  }

  protected stockTotal(): number {
    return this.vendorProducts().reduce((sum, product) => sum + Number(product.stockQuantity || 0), 0);
  }

  protected customerCartCount(): number {
    return this.vendorCartCustomers().length;
  }

  protected pendingOrderCount(): number {
    return this.vendorOrders().filter((order) => order.fulfillmentStatus !== 'fulfilled' && order.status !== 'cancelled').length;
  }

  protected activeDiscountCount(): number {
    return this.vendorDiscounts().filter((discount) => discount.status === 'active').length;
  }

  protected pendingDocumentCount(): number {
    return this.vendorDocuments().filter((document) => document.status === 'pending').length;
  }

  protected async saveStore(): Promise<void> {
    const vendor = this.activeVendor();
    if (!vendor) return;
    await this.post(`/api/vendors/${vendor.id}/store`, this.storeForm, 'Store profile saved.');
  }

  protected useCurrentLocationForStore(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.message.set('Location is not available in this browser.');
      return;
    }
    this.message.set('Checking this device location...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.storeForm.latitude = Number(position.coords.latitude.toFixed(6));
        this.storeForm.longitude = Number(position.coords.longitude.toFixed(6));
        this.message.set('Store map coordinates filled. Review them before saving.');
      },
      () => this.message.set('Location permission was not granted. You can enter latitude and longitude manually.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }

  protected async createListing(): Promise<void> {
    if (this.listingForm.status === 'published' && !this.canPublish(this.activeVendor())) {
      this.message.set('Business registration is required before products or foods can be published.');
      return;
    }
    await this.post('/api/products', { ...this.listingForm, vendorId: this.selectedVendorId }, 'Listing saved.');
    this.listingForm = { type: 'product', name: '', price: null, stockQuantity: null, deliveryDay: '', status: 'draft', description: '' };
  }

  protected async updateStock(product: any): Promise<void> {
    await this.post(`/api/products/${product.id}/stock`, { stockQuantity: product.stockQuantity }, 'Stock quantity updated.');
  }

  protected async updateProductStatus(product: any, status: string): Promise<void> {
    if (status === 'published' && !this.canPublish(this.activeVendor())) {
      this.message.set('Business registration is required before products or foods can be published.');
      return;
    }
    await this.post(`/api/products/${product.id}`, { status }, `Listing marked ${status}.`);
  }

  protected async createService(): Promise<void> {
    if (this.serviceForm.status === 'published' && !this.canPublish(this.activeVendor())) {
      this.message.set('Business registration is required before services can be published.');
      return;
    }
    await this.post('/api/services', { ...this.serviceForm, vendorId: this.selectedVendorId }, 'Service saved.');
    this.serviceForm = { name: '', category: '', price: null, pricingType: 'Fixed', status: 'draft', description: '' };
  }

  protected async updateServiceStatus(service: any, status: string): Promise<void> {
    if (status === 'published' && !this.canPublish(this.activeVendor())) {
      this.message.set('Business registration is required before services can be published.');
      return;
    }
    await this.post(`/api/services/${service.id}`, { status }, `Service marked ${status}.`);
  }

  protected async updateServiceBookingStatus(booking: any, status: string): Promise<void> {
    await this.post(`/api/bookings/${booking.id}/status`, {
      vendorId: booking.vendorId,
      status
    }, `Service booking marked ${status}.`);
  }

  protected async createDiscount(): Promise<void> {
    await this.post('/api/discounts', {
      ...this.discountForm,
      vendorId: this.selectedVendorId,
      scope: 'product'
    }, 'Discount created.');
    this.discountForm = { name: '', code: '', discountType: 'percent', amount: null };
  }

  protected discountIdsForProduct(product: any): string[] {
    return String(product.discountIds || '').split(',').map((id) => id.trim()).filter(Boolean);
  }

  protected discountLabel(discount: any): string {
    const amount = Number(discount.amount || 0);
    return discount.discountType === 'fixed' ? `${this.money(amount)} off` : `${amount}% off`;
  }

  protected listingDiscountLabel(product: any): string {
    const discount = product.discount;
    if (!discount) {
      return product.discountNames || 'Vendor offer';
    }
    const name = discount.name || discount.code || 'Vendor offer';
    return `${name}: ${this.discountLabel(discount)}`;
  }

  protected cartAgeLabel(hours: number): string {
    const value = Math.max(0, Number(hours || 0));
    if (value < 24) return `${value}h`;
    return `${Math.floor(value / 24)}d ${value % 24}h`;
  }

  protected async applyDiscountToProduct(product: any): Promise<void> {
    const discountId = this.selectedDiscountForProduct[product.id];
    if (!discountId) {
      this.message.set('Choose a discount before applying it to a listing.');
      return;
    }
    await this.post(`/api/products/${product.id}/discounts`, { discountId }, 'Discount applied to listing.');
    this.selectedDiscountForProduct[product.id] = '';
  }

  protected async removeDiscountFromProduct(product: any, discountId: string): Promise<void> {
    await this.post(`/api/products/${product.id}/discounts/${discountId}/remove`, {}, 'Discount removed from listing.');
  }

  protected async offerDiscountToCart(cart: any): Promise<void> {
    const discountId = this.selectedDiscountForCart[cart.cartId];
    if (!discountId) {
      this.message.set('Choose a discount before offering it to a cart.');
      return;
    }
    await this.post(`/api/carts/${cart.cartId}/discounts`, { vendorId: cart.vendorId, discountId }, 'Discount offered to cart.');
    this.selectedDiscountForCart[cart.cartId] = '';
  }

  protected async updateDiscountStatus(discount: any, status: string): Promise<void> {
    await this.post(`/api/discounts/${discount.id}/status`, { status }, `Discount ${status === 'active' ? 'enabled' : 'disabled'}.`);
  }

  protected async deleteDiscount(discount: any): Promise<void> {
    await this.post(`/api/discounts/${discount.id}/delete`, {}, 'Discount deleted.');
  }

  protected async addMedia(): Promise<void> {
    const store = this.activeStore();
    if (!store) return;
    await this.post(`/api/stores/${store.id}/media`, this.mediaForm, 'Store media added.');
    this.mediaForm = { mediaType: 'gallery', url: '' };
  }

  protected async uploadDocument(): Promise<void> {
    await this.post('/api/vendor-documents', { ...this.documentForm, vendorId: this.selectedVendorId }, 'Registration document uploaded for admin review.');
    this.documentForm = { documentType: 'Business registration document', fileUrl: '' };
  }

  protected async requestAssistance(): Promise<void> {
    const store = this.activeStore();
    if (!store) return;
    await this.post(`/api/vendors/${store.slug}/registration-assistance`, {}, 'Registration assistance requested.');
  }

  protected async updateOrderFulfillment(order: any, fulfillmentStatus: string): Promise<void> {
    await this.post(`/api/orders/${order.orderId}/status`, {
      vendorId: order.vendorId,
      fulfillmentStatus
    }, `Order ${order.orderId} marked ${fulfillmentStatus}.`);
  }

  protected async savePayoutProfile(): Promise<void> {
    const vendor = this.activeVendor();
    if (!vendor) return;
    await this.post(`/api/vendors/${vendor.id}/payout-profile`, this.payoutForm, 'Payout details saved.');
  }

  protected useSavedPayoutDetails(): void {
    this.syncPayoutFormFromProfile();
    this.checkoutForm = {
      ...this.checkoutForm,
      payoutMethod: this.payoutForm.payoutMethod,
      payoutDetails: this.payoutForm.payoutDetails
    };
  }

  protected async exportLedger(): Promise<void> {
    const vendor = this.activeVendor();
    if (!vendor) return;
    try {
      const response = await fetch(apiUrl(`/api/vendor-wallets/${vendor.id}/ledger.csv`), {
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
      link.download = `${vendor.name || 'vendor'}-market-credits-ledger.csv`.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
      link.click();
      URL.revokeObjectURL(url);
      this.message.set('Ledger exported.');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Ledger export failed.');
    }
  }

  protected async requestCheckout(): Promise<void> {
    const vendor = this.activeVendor();
    if (!vendor) return;
    const amount = Number(this.checkoutForm.amountCoins || 0);
    const wallet = this.activeWallet();
    const available = Number(wallet?.availableCoins || 0);
    const reserve = Number(wallet?.nextSubscriptionCost || 0);
    if (amount <= 0) {
      this.message.set('Enter a checkout amount greater than zero.');
      return;
    }
    if (amount > available) {
      this.message.set('Checkout amount cannot exceed available credits.');
      return;
    }
    const remaining = available - amount;
    if (typeof window !== 'undefined' && reserve > 0 && (amount >= available || remaining < reserve)) {
      const confirmed = window.confirm(`You are requesting ${amount} credits from ${available} available credits. This would leave ${Math.max(0, remaining)} credits, and your next subscription reserve is ${reserve} credits. Consider leaving enough to cover the next month. Continue?`);
      if (!confirmed) return;
    }
    await this.post('/api/vendor-wallets/checkout-requests', {
      vendorId: vendor.id,
      ...this.checkoutForm
    }, 'Checkout request created.');
    this.checkoutForm = {
      amountCoins: null,
      payoutMethod: this.payoutForm.payoutMethod || 'bank_transfer',
      payoutDetails: this.payoutForm.payoutDetails || ''
    };
  }

  protected canPayPlanWithCredits(plan: SubscriptionPlan): boolean {
    return Number(this.activeWallet()?.availableCoins || 0) >= Number(plan.monthlyPrice || 0);
  }

  protected async payPlanWithCredits(planId: string): Promise<void> {
    const vendor = this.activeVendor();
    if (!vendor) return;
    await this.post('/api/subscriptions/wallet-pay', { vendorId: vendor.id, planId }, 'Subscription paid with Market Credits.');
  }

  protected async featureProduct(product: any): Promise<void> {
    if (!this.canPublish(this.activeVendor())) {
      this.message.set('Business registration is required before a listing can be featured publicly.');
      return;
    }
    await this.post(`/api/products/${product.id}/feature`, { days: 7 }, 'Product featured for 7 days using Market Credits.');
  }

  protected async startCheckout(planId: string): Promise<void> {
    const vendor = this.activeVendor();
    const plan = this.plans().find((item) => item.id === planId);
    if (!vendor || !plan) return;
    try {
      const session = await this.subscriptions.createCheckout(vendor as any, plan);
      if (session.provider === 'mock') {
        await this.subscriptions.completeMockCheckout(session.id);
        this.message.set(`${plan.name} is active for ${vendor.name}.`);
        await this.loadOperations();
        return;
      }

      this.message.set(`Checkout session ${session.id} created for ${vendor.name}.`);
      if (typeof window !== 'undefined' && session.checkoutUrl) {
        window.location.href = session.checkoutUrl;
      }
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Checkout session could not be created.');
    }
  }

  protected storeUrl(): string {
    const slug = this.activeStore()?.slug ?? '';
    if (typeof window === 'undefined') return `/vendor/${slug}`;
    return `${window.location.origin}/vendor/${slug}`;
  }

  protected whatsappShare(): string {
    return `https://wa.me/?text=${encodeURIComponent(`Shop my Urban Market JA store: ${this.storeUrl()}`)}`;
  }

  protected facebookShare(): string {
    return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(this.storeUrl())}`;
  }

  protected async copyStoreLink(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(this.storeUrl());
      this.copyLabel.set('Copied');
      window.setTimeout(() => this.copyLabel.set('Copy link'), 1800);
    }
  }

  protected daysLeft(vendor: VendorRecord | null): number {
    if (!vendor) return 0;
    const expiry = this.unregisteredExpiry(vendor);
    return Math.ceil((expiry.getTime() - Date.now()) / 86400000);
  }

  protected compliance(vendor: VendorRecord | null): string {
    if (!vendor) return 'Vendor data is not loaded.';
    if (vendor.subscriptionStatus === 'past_due') {
      return 'Subscription is past due. Product publishing is paused until payment is restored.';
    }
    if (vendor.registrationStatus === 'registered') {
      return 'Vendor is compliant.';
    }
    const daysRemaining = this.daysLeft(vendor);
    return daysRemaining < 0
      ? 'Registration window expired. Business registration is required before this store can appear publicly.'
      : 'Business registration is required before this store and its listings can appear publicly. Registration assistance should be offered.';
  }

  protected severity(vendor: VendorRecord | null): string {
    if (!vendor) return 'notice';
    if (vendor.subscriptionStatus === 'past_due') return 'critical';
    if (vendor.registrationStatus === 'registered') return 'ok';
    const daysRemaining = this.daysLeft(vendor);
    return daysRemaining <= 7 ? 'critical' : daysRemaining <= 90 ? 'warning' : 'notice';
  }

  protected canPublish(vendor: VendorRecord | null): boolean {
    return !!vendor && vendor.subscriptionStatus === 'active' && vendor.registrationStatus === 'registered';
  }

  private unregisteredExpiry(vendor: VendorRecord): Date {
    const expiry = new Date(vendor.onboardedAt);
    expiry.setFullYear(expiry.getFullYear() + 1);
    return expiry;
  }

  private syncPayoutFormFromProfile(): void {
    const profile = (this.operations()?.payoutProfiles ?? []).find((item: any) => item.vendorId === this.selectedVendorId);
    this.payoutForm = {
      payoutMethod: profile?.payoutMethod || this.payoutForm.payoutMethod || 'bank_transfer',
      payoutDetails: profile?.payoutDetails || this.payoutForm.payoutDetails || ''
    };
    if (!this.checkoutForm.payoutDetails) {
      this.checkoutForm = {
        ...this.checkoutForm,
        payoutMethod: this.payoutForm.payoutMethod,
        payoutDetails: this.payoutForm.payoutDetails
      };
    }
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
