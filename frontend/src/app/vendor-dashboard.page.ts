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
  themeKey?: string;
  themePrimaryColor?: string | null;
  themeAccentColor?: string | null;
  themeBackgroundColor?: string | null;
  status: string;
}

interface StoreMediaRecord {
  id: string;
  storeId: string;
  mediaType: string;
  url: string;
  altText?: string;
  sortOrder?: number;
}

interface StoreSocialLink {
  id?: string;
  storeId?: string;
  platform: string;
  label?: string;
  url: string;
  status?: string;
  sortOrder?: number;
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
  subscriptionPlanCode?: string;
  nextBillingAt?: string;
}

interface ListingImageUpload {
  imageName: string;
  imageMimeType: string;
  imageSizeBytes: number;
  imageDataBase64: string;
}

type CustomizationFieldType = 'text' | 'number' | 'color' | 'select' | 'checkbox' | 'image';

interface CustomizationPlacementDraft {
  id: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  rotationDegrees: number;
  fontFamily: string;
  fontSizePercent: number;
  fontWeight: string;
  textAlign: string;
  textColor: string;
  backgroundColor: string;
  zIndex: number;
}

interface CustomizationFieldDraft {
  id: string;
  localId: string;
  fieldKey: string;
  label: string;
  fieldType: CustomizationFieldType;
  placeholder: string;
  defaultValue: string;
  helpText: string;
  isRequired: boolean;
  minLength: number | null;
  maxLength: number | null;
  minValue: number | null;
  maxValue: number | null;
  priceDeltaJmd: number | null;
  optionsText: string;
  placement: CustomizationPlacementDraft;
  placementsBySurface: Record<string, CustomizationPlacementDraft>;
}

interface CustomizationSurfaceDraft {
  id: string;
  name: string;
  surfaceKey: string;
  baseImageUrl: string;
  widthPx: number;
  heightPx: number;
  sortOrder: number;
  upload: ListingImageUpload;
}

interface CustomizationBuilderState {
  productId: string;
  productName: string;
  productType: string;
  title: string;
  instructions: string;
  status: 'draft' | 'active' | 'paused';
  surface: CustomizationSurfaceDraft;
  surfaces: CustomizationSurfaceDraft[];
  selectedSurfaceId: string;
  fields: CustomizationFieldDraft[];
  selectedFieldId: string;
}

interface CustomizationPresetSurface {
  name: string;
  surfaceKey: string;
  widthPx: number;
  heightPx: number;
}

interface CustomizationFontOption {
  label: string;
  value: string;
  webFont?: string;
}

interface CustomizationPresetField {
  label: string;
  fieldType: CustomizationFieldType;
  placeholder?: string;
  defaultValue?: string;
  helpText?: string;
  isRequired?: boolean;
  maxLength?: number;
  priceDeltaJmd?: number | null;
  optionsText?: string;
  surfaceKey: string;
  placement?: Partial<CustomizationPlacementDraft>;
}

interface CustomizationPresetConfig {
  value: string;
  label: string;
  instructions: string;
  surfaces: CustomizationPresetSurface[];
  fields: CustomizationPresetField[];
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
                  <span class="action-note">{{ publishReadinessMessage() }}</span>
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
                          <td>
                            <span>{{ order.productCount }} products / {{ order.itemCount }} units</span>
                            @if (order.items?.length) {
                              <div class="vendor-order-items">
                                @for (item of order.items; track item.id) {
                                  <article class="vendor-order-item">
                                    @if (customizationPreviewImage(item)) {
                                      <div class="cart-custom-preview vendor-order-preview">
                                        <img [src]="customizationPreviewImage(item)" [alt]="item.name + ' customization preview'" loading="lazy" decoding="async">
                                        @for (field of customizationPreviewFields(item); track field.fieldKey || field.label) {
                                          <span class="custom-mini-field"
                                            [style.left.%]="customizationPreviewPlacement(field).xPercent"
                                            [style.top.%]="customizationPreviewPlacement(field).yPercent"
                                            [style.width.%]="customizationPreviewPlacement(field).widthPercent"
                                            [style.height.%]="customizationPreviewPlacement(field).heightPercent"
                                            [style.transform]="customizationPreviewTransform(field)"
                                            [style.font-family]="customizationPreviewFontFamily(field)"
                                            [style.color]="customizationPreviewPlacement(field).textColor || '#132f3a'"
                                            [style.font-size.px]="customizationPreviewPlacement(field).fontSizePercent ? customizationPreviewPlacement(field).fontSizePercent * 1.2 : 16"
                                            [style.font-weight]="customizationPreviewPlacement(field).fontWeight || '700'"
                                            [style.text-align]="customizationPreviewPlacement(field).textAlign || 'center'">
                                            @if (field.imageUrl) {
                                              <img class="custom-mini-image" [src]="mediaUrl(field.imageUrl)" [alt]="field.label || 'Uploaded custom image'" loading="lazy" decoding="async">
                                            } @else {
                                              {{ field.value || field.label }}
                                            }
                                          </span>
                                        }
                                      </div>
                                    }
                                    <div>
                                      <strong>{{ item.name }}</strong>
                                      <span class="product-meta">Qty {{ item.qty }} - {{ money(item.lineTotal || item.price * item.qty) }}</span>
                                      @if (customizationSummary(item)) {
                                        <span class="product-meta order-custom-summary">Custom: {{ customizationSummary(item) }}</span>
                                      }
                                      @if (customizationAddOnTotal(item)) {
                                        <span class="product-meta order-custom-summary">Add-ons paid: {{ money(customizationAddOnTotal(item)) }}</span>
                                      }
                                      <span class="status-pill" [class.warn]="item.fulfillmentStatus !== 'fulfilled'">{{ item.fulfillmentStatus || 'pending' }}</span>
                                      @if (customizationSummary(item) && order.paymentStatus === 'paid' && !order.hasOpenDispute && item.fulfillmentStatus !== 'fulfilled') {
                                        <button class="button-sm" type="button" (click)="updateOrderFulfillment(order, 'fulfilled', item.id)">Mark custom item fulfilled</button>
                                      }
                                    </div>
                                  </article>
                                }
                              </div>
                            }
                          </td>
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
                            @if (orderHasCustomItems(order)) {
                              <button class="button-sm light" type="button" (click)="downloadProductionSheet(order)">Production sheet</button>
                            }
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
                  <div class="form-section">
                    <h2>Store profile</h2>
                    <p class="product-meta">This is what customers see on your storefront and marketplace listings.</p>
                    <label>Store name <input name="storeName" [(ngModel)]="storeForm.name" required></label>
                    <label>Public URL slug <input name="storeSlug" [(ngModel)]="storeForm.slug" required></label>
                    <label>Status <select name="storeStatus" [(ngModel)]="storeForm.status"><option>draft</option><option>active</option><option>paused</option></select></label>
                    <label>Store theme
                      <select name="storeTheme" [(ngModel)]="storeForm.themeKey">
                        @for (theme of storeThemeOptions; track theme.value) {
                          <option [value]="theme.value">{{ theme.label }}</option>
                        }
                      </select>
                    </label>
                    <div class="form-grid compact-form theme-color-grid">
                      <label>Primary color <input name="themePrimaryColor" type="color" [(ngModel)]="storeForm.themePrimaryColor"></label>
                      <label>Accent color <input name="themeAccentColor" type="color" [(ngModel)]="storeForm.themeAccentColor"></label>
                      <label>Hero background <input name="themeBackgroundColor" type="color" [(ngModel)]="storeForm.themeBackgroundColor"></label>
                    </div>
                    <label>Summary <textarea name="storeSummary" [(ngModel)]="storeForm.summary" rows="4" placeholder="Tell customers what your store offers"></textarea></label>
                  </div>

                  <div class="form-section">
                    <h3>Location and map</h3>
                    <p class="product-meta">Saved coordinates power the customer distance estimate and Directions button.</p>
                    <label>Location area
                      <input name="storeLocation" list="storeLocationOptions" [(ngModel)]="storeForm.location" placeholder="Half Way Tree, Portmore, Spanish Town">
                    </label>
                    <datalist id="storeLocationOptions">
                      @for (location of popularLocations; track location) {
                        <option [value]="location"></option>
                      }
                    </datalist>
                    <label>Street or pickup address <input name="storeAddressLine1" [(ngModel)]="storeForm.addressLine1" placeholder="Street, plaza, shop number, or pickup point"></label>
                    <label>Address line 2 <input name="storeAddressLine2" [(ngModel)]="storeForm.addressLine2" placeholder="Suite, unit, landmark"></label>
                    <label>Parish
                      <select name="storeParish" [(ngModel)]="storeForm.parish">
                        <option value="">Select parish</option>
                        @for (parish of parishOptions; track parish) {
                          <option [value]="parish">{{ parish }}</option>
                        }
                      </select>
                    </label>
                    <div class="form-grid compact-form">
                      <label>Latitude <input name="storeLatitude" type="number" step="any" [(ngModel)]="storeForm.latitude" placeholder="18.0125"></label>
                      <label>Longitude <input name="storeLongitude" type="number" step="any" [(ngModel)]="storeForm.longitude" placeholder="-76.7981"></label>
                    </div>
                    <div class="location-actions">
                      <button class="button outline-button" type="button" (click)="useCurrentLocationForStore()">Use live location</button>
                      <span class="product-meta">{{ coordinateStatus() }}</span>
                    </div>
                  </div>

                  <button class="button primary-button" type="submit">Save store</button>
                </form>

                <article class="dashboard-card">
                  <h2>Share tools</h2>
                  @if (activeStore()?.slug) {
                    <p class="product-meta">These links update for the selected store.</p>
                    <p>{{ storeUrl() }}</p>
                    <div class="share-actions">
                      <button class="button secondary-button" type="button" (click)="copyStoreLink()">{{ copyLabel() }}</button>
                      <a class="button outline-button" [href]="whatsappShare()" target="_blank" rel="noopener">WhatsApp</a>
                      <a class="button outline-button" [href]="facebookShare()" target="_blank" rel="noopener">Facebook</a>
                    </div>
                  }
                  <h3>Store media</h3>
                  <p class="product-meta">Upload a logo for the store badge, a banner for the storefront hero, and gallery images for store media.</p>
                  <form class="profile-form compact-form" (ngSubmit)="addMedia()">
                    <label>Media URL <input name="mediaUrl" [(ngModel)]="mediaForm.url" placeholder="https://..."></label>
                    <label>Media type <select name="mediaType" [(ngModel)]="mediaForm.mediaType"><option>logo</option><option>banner</option><option>gallery</option></select></label>
                    <div class="document-upload-actions">
                      <label class="button secondary-button file-choice-button" for="storeMediaImageFile">Choose image</label>
                      <input id="storeMediaImageFile" class="visually-hidden-file" name="storeMediaImageFile" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" (change)="selectStoreMediaFile($event)">
                    </div>
                    <p class="product-meta">{{ imageFileLabel(mediaImageForm, 'Optional JPG, PNG, WEBP, HEIC, or HEIF image up to 8 MB.') }}</p>
                    <button class="button secondary-button" type="submit">Add media</button>
                  </form>
                  @if (storeMedia().length) {
                    <div class="store-media-preview-grid">
                      @for (media of storeMedia(); track media.id) {
                        <figure>
                          <img [src]="media.url" [alt]="media.altText || media.mediaType">
                          <figcaption>{{ media.mediaType }}</figcaption>
                        </figure>
                      }
                    </div>
                  }

                  <h3>Social media accounts</h3>
                  <p class="product-meta">Add accounts customers should see under Follow us on your store page.</p>
                  <form class="profile-form compact-form" (ngSubmit)="saveSocialLink()">
                    <label>Platform
                      <select name="socialPlatform" [(ngModel)]="socialForm.platform">
                        @for (platform of socialPlatforms; track platform.value) {
                          <option [value]="platform.value">{{ platform.label }}</option>
                        }
                      </select>
                    </label>
                    <label>Handle, phone, or URL <input name="socialUrl" [(ngModel)]="socialForm.url" placeholder="@store, 1876..., or https://..." required></label>
                    <label>Display label <input name="socialLabel" [(ngModel)]="socialForm.label" placeholder="Follow us"></label>
                    <button class="button secondary-button" type="submit">Save social account</button>
                  </form>
                  @if (storeSocialLinks().length) {
                    <div class="social-link-list">
                      @for (link of storeSocialLinks(); track link.platform) {
                        <div class="social-link-row">
                          <a [href]="link.url" target="_blank" rel="noopener">
                            <span class="social-icon" [attr.data-platform]="link.platform">{{ socialIcon(link.platform) }}</span>
                            <span>{{ link.label || socialName(link.platform) }}</span>
                          </a>
                          <button class="button-sm danger" type="button" (click)="removeSocialLink(link)">Remove</button>
                        </div>
                      }
                    </div>
                  }
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
                      <strong>Publishing paused</strong>
                      <p>{{ publishReadinessMessage() }}</p>
                    </div>
                  }
                  <div class="form-grid">
                    <label>Type <select name="productType" [(ngModel)]="listingForm.type" (ngModelChange)="listingTypeChanged($event)"><option value="product">Product</option><option value="food">Food</option></select></label>
                    <label>Name <input name="productName" [(ngModel)]="listingForm.name" required></label>
                    <label>Price JMD <input name="productPrice" type="number" [(ngModel)]="listingForm.price" placeholder="Enter amount in JMD" required></label>
                    <label>Stock quantity <input name="productStockQuantity" type="number" min="0" [(ngModel)]="listingForm.stockQuantity" placeholder="Available quantity"></label>
                    <label>Delivery day <input name="deliveryDay" [(ngModel)]="listingForm.deliveryDay" placeholder="Mon, Wed, pickup, etc."></label>
                    <label>Status <select name="productStatus" [(ngModel)]="listingForm.status"><option>draft</option><option [disabled]="!canPublish(activeVendor())">published</option></select></label>
                  </div>
                  @if (listingForm.type === 'product') {
                    <div class="custom-mode-panel">
                      <div>
                        <strong>Product setup</strong>
                        <p class="product-meta">Standard items sell as-is. Customizable items collect customer text, numbers, colors, or choices before checkout.</p>
                      </div>
                      <div class="custom-mode-options" role="radiogroup" aria-label="Product setup">
                        <label>
                          <input type="radio" name="listingProductMode" value="standard" [ngModel]="listingProductMode" (ngModelChange)="setListingProductMode($event)">
                          Standard product
                        </label>
                        <label>
                          <input type="radio" name="listingProductMode" value="customizable" [ngModel]="listingProductMode" (ngModelChange)="setListingProductMode($event)">
                          Customizable product
                        </label>
                      </div>
                    </div>
                  }
                  <label>Description <textarea name="productDescription" [(ngModel)]="listingForm.description" rows="3" placeholder="Describe the item"></textarea></label>
                  <div class="document-upload-actions">
                    <label class="button secondary-button file-choice-button" for="listingImageFile">Choose product photo</label>
                    <input id="listingImageFile" class="visually-hidden-file" name="listingImageFile" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" (change)="selectListingImageFile($event)">
                  </div>
                  <p class="product-meta">{{ imageFileLabel(listingImageForm, 'Optional JPG, PNG, WEBP, HEIC, or HEIF image up to 8 MB.') }}</p>
                  <div class="listing-preview-panel">
                    <div class="section-heading compact-heading">
                      <h3>Customer preview</h3>
                      <p>This is how the listing card will read before the customer opens the full product page.</p>
                    </div>
                    <article class="product-card listing-preview-card">
                      <div class="product-image" [class.has-photo]="listingPreviewImage()">
                        @if (listingPreviewImage()) {
                          <img [src]="listingPreviewImage()" [alt]="listingPreviewName()" loading="lazy" decoding="async">
                        } @else {
                          <span class="visual-icon">{{ listingPreviewCategory() }}</span>{{ listingPreviewCategory() }}
                        }
                      </div>
                      <p class="product-tag">Delivery: {{ listingForm.deliveryDay || 'Available' }}</p>
                      <h3>{{ listingPreviewName() }}</h3>
                      <p>{{ listingForm.description || 'Add a short description so customers know what they are buying.' }}</p>
                      <div class="product-footer">
                        <strong>{{ money(listingPreviewPrice()) }}</strong>
                        <span class="button-sm light">Store page</span>
                      </div>
                    </article>
                  </div>
                  <button class="button primary-button" type="submit">Create listing</button>
                </form>

                @if (showCustomizationBuilder()) {
                  <section class="custom-builder-panel" (input)="scheduleCustomizationAutosave()" (change)="scheduleCustomizationAutosave()">
                    <div class="admin-panel-header">
                      <div>
                        <h3>{{ customizationBuilder.productId ? 'Product customizer' : 'Customizer for new listing' }}</h3>
                        <p>{{ customizationBuilder.productId ? customizationBuilder.productName : 'Set this up before creating the listing.' }}</p>
                      </div>
                      <div class="action-cell">
                        @if (customizationBuilder.productId) {
                          <button class="button-sm" type="button" (click)="saveCustomizationBuilder()">Save customizer</button>
                          <button class="button-sm light" type="button" (click)="closeCustomizationBuilder()">Close</button>
                        } @else {
                          <span class="status-pill">Saves with listing</span>
                        }
                      </div>
                    </div>
                    <div class="custom-builder-toolbar">
                      <span class="status-pill">{{ customizationAutosaveLabel() }}</span>
                      <span class="product-meta">Editing: {{ customizationBuilder.surface.name || 'Current side' }}</span>
                      <button class="button-sm light" type="button" (click)="applyCustomizationPreset(true, true)">Reset to selected product type</button>
                      @if (customizationBuilder.productId) {
                        <button class="button-sm light" type="button" (click)="useCustomizationSurfaceAsProductImage()">Use this side as listing photo</button>
                        <button class="button-sm" type="button" (click)="saveCustomizationBuilder()">Save now</button>
                      }
                    </div>

                    <div class="custom-builder-grid">
                      <div class="custom-builder-controls">
                        <div class="form-grid compact-form">
                          <label>Preset
                            <select [(ngModel)]="customizationBuilder.productType" name="customProductType" (ngModelChange)="customizationPresetChanged($event)">
                              @for (preset of customizationPresetOptions; track preset.value) {
                                <option [value]="preset.value">{{ preset.label }}</option>
                              }
                            </select>
                          </label>
                          <label>Status
                            <select [(ngModel)]="customizationBuilder.status" name="customTemplateStatus">
                              <option value="draft">Draft</option>
                              <option value="active">Active</option>
                              <option value="paused">Paused</option>
                            </select>
                          </label>
                          <label>Title <input [(ngModel)]="customizationBuilder.title" name="customTemplateTitle" placeholder="Personalize this item"></label>
                          <label>Instructions <input [(ngModel)]="customizationBuilder.instructions" name="customTemplateInstructions" placeholder="Tell customers what they can customize"></label>
                        </div>
                        <div class="action-cell preset-actions">
                          <button class="button-sm light" type="button" (click)="applyCustomizationPreset(true, true)">Apply product preset</button>
                        </div>

                        <div class="custom-surface-card">
                          <div>
                            <strong>Product surfaces</strong>
                            <p class="product-meta">{{ customizationPresetSurfaceHint() }}</p>
                          </div>
                          <div class="custom-surface-tabs" role="tablist" aria-label="Customization surfaces">
                            @for (surface of customizationBuilder.surfaces; track surface.id) {
                              <button class="button-sm light" type="button" [class.active]="surface.id === customizationBuilder.selectedSurfaceId" (click)="selectCustomizationSurface(surface.id)">
                                {{ surface.name }}
                              </button>
                            }
                          </div>
                          <div class="form-grid compact-form">
                            <label>Surface name <input [(ngModel)]="customizationBuilder.surface.name" name="customSurfaceName" placeholder="Front, back, wrap, label"></label>
                            <label>Surface key <input [(ngModel)]="customizationBuilder.surface.surfaceKey" name="customSurfaceKey" placeholder="front"></label>
                            <label>Width px <input type="number" min="200" [(ngModel)]="customizationBuilder.surface.widthPx" name="customSurfaceWidth"></label>
                            <label>Height px <input type="number" min="200" [(ngModel)]="customizationBuilder.surface.heightPx" name="customSurfaceHeight"></label>
                          </div>
                          <div class="document-upload-actions">
                            <label class="button secondary-button file-choice-button" for="customSurfaceImageFile">Choose base image</label>
                            <input id="customSurfaceImageFile" class="visually-hidden-file" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" (change)="selectCustomizationSurfaceImage($event)">
                            <button class="button-sm light" type="button" (click)="addCustomizationSurface()">Add surface</button>
                            <button class="button-sm danger" type="button" [disabled]="customizationBuilder.surfaces.length <= 1" (click)="removeActiveCustomizationSurface()">Remove surface</button>
                          </div>
                          <p class="product-meta">{{ customizationSurfaceLabel() }}</p>
                        </div>

                        <div class="custom-field-add">
                          <strong>Add customer input to {{ customizationBuilder.surface.name || 'this side' }}</strong>
                          <div class="form-grid compact-form">
                            <label>Label <input [(ngModel)]="customizationFieldForm.label" name="customNewFieldLabel" placeholder="Name, number, color, size"></label>
                            <label>Type
                              <select [(ngModel)]="customizationFieldForm.fieldType" name="customNewFieldType">
                                @for (type of customizationFieldTypes; track type.value) {
                                  <option [value]="type.value">{{ type.label }}</option>
                                }
                              </select>
                            </label>
                            <label>Placeholder <input [(ngModel)]="customizationFieldForm.placeholder" name="customNewFieldPlaceholder" placeholder="Shown to customer"></label>
                            <label>Default/sample <input [(ngModel)]="customizationFieldForm.defaultValue" name="customNewFieldDefault" placeholder="Preview value"></label>
                            <label>Add-on price <input type="number" min="0" step="1" [(ngModel)]="customizationFieldForm.priceDeltaJmd" name="customNewFieldPrice" placeholder="0"></label>
                            @if (customizationFieldForm.fieldType === 'select') {
                              <label class="wide-field">Dropdown options <input [(ngModel)]="customizationFieldForm.optionsText" name="customNewFieldOptions" placeholder="Small, Medium +200, Large +500"></label>
                            }
                          </div>
                          <label class="checkbox-line"><input type="checkbox" [(ngModel)]="customizationFieldForm.isRequired" name="customNewFieldRequired"> Required field</label>
                          <button class="button-sm" type="button" (click)="addCustomizationField()">Add field to this side</button>
                        </div>

                        @if (customizationFieldsAwayFromActiveSurface().length) {
                          <div class="custom-field-add compact-add">
                            <strong>Add existing input to this side</strong>
                            <div class="inline-control">
                              <select [(ngModel)]="fieldToAddToSurface" name="customExistingFieldForSurface">
                                <option value="">Choose an input</option>
                                @for (field of customizationFieldsAwayFromActiveSurface(); track field.localId) {
                                  <option [value]="field.localId">{{ field.label }}</option>
                                }
                              </select>
                              <button class="button-sm light" type="button" (click)="addExistingCustomizationFieldToActiveSurface()">Add to {{ customizationBuilder.surface.name || 'side' }}</button>
                            </div>
                          </div>
                        }

                        @if (customizationFieldsForActiveSurface().length) {
                          <div class="custom-field-list">
                            <strong>Inputs on {{ customizationBuilder.surface.name || 'this side' }}</strong>
                            @for (field of customizationFieldsForActiveSurface(); track field.localId) {
                              <button type="button" [class.active]="customizationBuilder.selectedFieldId === field.localId" (click)="selectCustomizationField(field.localId)">
                                <span>{{ field.label }}</span>
                                <small>{{ customizationFieldTypeLabel(field.fieldType) }}{{ customizationFieldPriceLabel(field) }}</small>
                              </button>
                            }
                          </div>
                        } @else {
                          <div class="notice neutral-notice">
                            <p>No customer inputs are placed on {{ customizationBuilder.surface.name || 'this side' }} yet.</p>
                          </div>
                        }
                      </div>

                      <div class="custom-preview-column">
                        <div class="custom-preview-canvas" (pointermove)="dragCustomizationField($event)" (pointerup)="endCustomizationDrag()" (pointerleave)="endCustomizationDrag()">
                          @if (customizationSurfacePreviewUrl()) {
                            <img [src]="customizationSurfacePreviewUrl()" [alt]="customizationBuilder.title || customizationBuilder.productName || listingPreviewName()">
                          } @else {
                            <div class="custom-preview-empty">
                              <strong>Choose a base image</strong>
                              <span>The customization layout appears here.</span>
                            </div>
                          }
                          @for (field of customizationFieldsForActiveSurface(); track field.localId) {
                            <div class="custom-preview-field"
                              role="button"
                              tabindex="0"
                              [attr.aria-label]="'Move ' + field.label"
                              [class.active]="customizationBuilder.selectedFieldId === field.localId"
                              [class.image-field]="field.fieldType === 'image'"
                              [style.left.%]="activePlacement(field).xPercent"
                              [style.top.%]="activePlacement(field).yPercent"
                              [style.width.%]="activePlacement(field).widthPercent"
                              [style.height.%]="activePlacement(field).heightPercent"
                              [style.transform]="customizationFieldTransform(field)"
                              [style.background]="activePlacement(field).backgroundColor || 'transparent'"
                              [style.z-index]="activePlacement(field).zIndex"
                              (pointerdown)="startCustomizationDrag($event, field.localId)">
                              <span class="custom-preview-value"
                                [style.font-family]="customizationFieldFontFamily(field)"
                                [style.font-size.px]="customizationFieldFontSize(field)"
                                [style.font-weight]="activePlacement(field).fontWeight"
                                [style.text-align]="activePlacement(field).textAlign"
                                [style.color]="activePlacement(field).textColor">{{ customizationPreviewValue(field) }}</span>
                              @if (customizationBuilder.selectedFieldId === field.localId) {
                                <span class="custom-resize-handle" aria-hidden="true" (pointerdown)="startCustomizationResize($event, field.localId)"></span>
                              }
                            </div>
                          }
                        </div>
                        <p class="product-meta">Drag a field to move it. Drag the corner handle to resize it. Positions and sizes save as percentages for desktop and mobile.</p>
                        @if (customizationPrintWarnings().length) {
                          <div class="notice print-warning">
                            @for (warning of customizationPrintWarnings(); track warning) {
                              <p>{{ warning }}</p>
                            }
                          </div>
                        }

                        @if (selectedCustomizationField(); as field) {
                          <div class="custom-placement-editor">
                            <div class="custom-field-editor">
                              <strong>Selected field</strong>
                              <div class="form-grid compact-form">
                                <label>Label <input [(ngModel)]="field.label" [name]="'customEditLabel' + field.localId" placeholder="Customer field label"></label>
                                <label>Type
                                  <select [(ngModel)]="field.fieldType" [name]="'customEditType' + field.localId" (ngModelChange)="customizationFieldChanged(field)">
                                    @for (type of customizationFieldTypes; track type.value) {
                                      <option [value]="type.value">{{ type.label }}</option>
                                    }
                                  </select>
                                </label>
                                <label>Placeholder <input [(ngModel)]="field.placeholder" [name]="'customEditPlaceholder' + field.localId" placeholder="Shown before the customer types"></label>
                                <label>Preview sample <input [(ngModel)]="field.defaultValue" [name]="'customEditDefault' + field.localId" placeholder="Live preview value"></label>
                                <label>Add-on price <input type="number" min="0" step="1" [(ngModel)]="field.priceDeltaJmd" [name]="'customEditPrice' + field.localId" placeholder="0"></label>
                                @if (field.fieldType === 'select') {
                                  <label class="wide-field">Dropdown options <input [(ngModel)]="field.optionsText" [name]="'customEditOptions' + field.localId" placeholder="Small, Medium +200, Large +500"></label>
                                }
                              </div>
                              <label class="checkbox-line"><input type="checkbox" [(ngModel)]="field.isRequired" [name]="'customEditRequired' + field.localId"> Required field</label>
                            </div>
                            <div class="form-grid compact-form">
                              <label>X position <input type="number" min="0" max="100" [(ngModel)]="field.placement.xPercent" [name]="'customX' + field.localId"></label>
                              <label>Y position <input type="number" min="0" max="100" [(ngModel)]="field.placement.yPercent" [name]="'customY' + field.localId"></label>
                              <label>Width % <input type="number" min="8" max="100" [(ngModel)]="field.placement.widthPercent" [name]="'customWidth' + field.localId"></label>
                              <label>Height % <input type="number" min="4" max="60" [(ngModel)]="field.placement.heightPercent" [name]="'customHeight' + field.localId"></label>
                              <label>Text size % <input type="number" min="6" max="40" [(ngModel)]="field.placement.fontSizePercent" [name]="'customSize' + field.localId"></label>
                              @if (customizationFieldUsesFont(field)) {
                                <label>Font style
                                  <select [ngModel]="field.placement.fontFamily || ''" (ngModelChange)="selectCustomizationFont(field, $event)" [name]="'customFont' + field.localId">
                                    <option value="">Default store font</option>
                                    @if (recentCustomizationFonts.length) {
                                      <optgroup label="Recently used">
                                        @for (font of recentCustomizationFonts; track font) {
                                          <option [value]="font">{{ fontLabel(font) }}</option>
                                        }
                                      </optgroup>
                                    }
                                    <optgroup label="Common fonts">
                                      @for (font of customizationFontOptions; track font.value) {
                                        <option [value]="font.value">{{ font.label }}</option>
                                      }
                                    </optgroup>
                                  </select>
                                </label>
                                <label>Font weight
                                  <select [(ngModel)]="field.placement.fontWeight" [name]="'customFontWeight' + field.localId">
                                    @for (weight of customizationFontWeights; track weight.value) {
                                      <option [value]="weight.value">{{ weight.label }}</option>
                                    }
                                  </select>
                                </label>
                                <label class="wide-field">Search/add font
                                  <input [(ngModel)]="customizationFontSearch" [name]="'customFontSearch' + field.localId" [attr.list]="'customFontList' + field.localId" placeholder="Type a font name, for example Poppins">
                                  <datalist [id]="'customFontList' + field.localId">
                                    @for (font of allCustomizationFontSuggestions(); track font.value) {
                                      <option [value]="font.webFont || font.label"></option>
                                    }
                                  </datalist>
                                </label>
                                <button class="button-sm light" type="button" (click)="addSearchedCustomizationFont(field)">Use searched font</button>
                              }
                              <label>Text color <input type="color" [(ngModel)]="field.placement.textColor" [name]="'customColor' + field.localId"></label>
                              <label>Rotate <input type="number" min="-180" max="180" [(ngModel)]="field.placement.rotationDegrees" [name]="'customRotate' + field.localId"></label>
                            </div>
                            <div class="alignment-buttons" role="group" aria-label="Text alignment">
                              <button class="button-sm light" type="button" [class.active]="field.placement.textAlign === 'left'" (click)="setCustomizationTextAlign(field, 'left')">Left</button>
                              <button class="button-sm light" type="button" [class.active]="field.placement.textAlign === 'center'" (click)="setCustomizationTextAlign(field, 'center')">Center</button>
                              <button class="button-sm light" type="button" [class.active]="field.placement.textAlign === 'right'" (click)="setCustomizationTextAlign(field, 'right')">Right</button>
                            </div>
                            <div class="action-cell">
                              <span class="product-meta">This input appears on {{ fieldSurfaceCount(field) }} side{{ fieldSurfaceCount(field) === 1 ? '' : 's' }}.</span>
                              <button class="button-sm danger" type="button" (click)="removeCustomizationFieldFromActiveSurface(field.localId)">Remove from this side</button>
                              <button class="button-sm light" type="button" (click)="removeCustomizationField(field.localId)">Delete everywhere</button>
                            </div>
                          </div>
                        }
                      </div>
                    </div>
                  </section>
                }

                <div class="table-wrap">
                  <table class="admin-table">
                    <thead><tr><th>Listing</th><th>Type</th><th>Price</th><th>Stock</th><th>Discounts</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      @for (product of vendorProducts(); track product.id) {
                        <tr>
                          <td>
                            <div class="listing-cell">
                              @if (product.imageUrl) {
                                <img class="listing-thumb" [src]="mediaUrl(product.imageUrl)" [alt]="product.name" loading="lazy" decoding="async">
                              }
                              <div><strong>{{ product.name }}</strong><br><span class="product-meta">{{ product.description || 'No description' }}</span></div>
                            </div>
                          </td>
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
                          <td class="action-cell listing-actions">
                            <button class="button-sm light" type="button" (click)="startProductEdit(product)">Edit</button>
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
                            <label class="button-sm" [for]="'productPhoto' + product.id">Photo</label>
                            <input [id]="'productPhoto' + product.id" class="visually-hidden-file" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" (change)="selectProductImageFile(product, $event)">
                            @if (productImageDrafts[product.id]?.imageDataBase64) {
                              <button class="button-sm" type="button" (click)="uploadProductImage(product)">Upload photo</button>
                            }
                            <button class="button-sm" type="button" (click)="openCustomizationBuilder(product)">
                              {{ customizationTemplateForProduct(product.id) ? 'Edit customizer' : 'Add customizer' }}
                            </button>
                            @if (customizationTemplateForProduct(product.id)?.surfaces?.length) {
                              <button class="button-sm light" type="button" (click)="useProductCustomizerImage(product)">Use customizer photo</button>
                            }
                          </td>
                        </tr>
                        @if (editingProductId === product.id) {
                          <tr class="edit-row">
                            <td colspan="7">
                              <form class="inline-edit-form" (ngSubmit)="saveProductEdit(product)">
                                <div class="admin-panel-header compact-heading">
                                  <div>
                                    <h3>Edit {{ product.name }}</h3>
                                    <p>Update the listing details customers see in the marketplace and store page.</p>
                                  </div>
                                  <div class="action-cell">
                                    <button class="button-sm light" type="button" (click)="cancelProductEdit()">Cancel</button>
                                    <button class="button-sm" type="submit">Save changes</button>
                                  </div>
                                </div>
                                <div class="form-grid compact-form">
                                  <label>Type
                                    <select [(ngModel)]="productEditForm.type" [name]="'editType' + product.id">
                                      <option value="product">Product</option>
                                      <option value="food">Food</option>
                                    </select>
                                  </label>
                                  <label>Name <input [(ngModel)]="productEditForm.name" [name]="'editName' + product.id" required></label>
                                  <label>Price JMD <input type="number" min="0" [(ngModel)]="productEditForm.price" [name]="'editPrice' + product.id" required></label>
                                  <label>Stock quantity <input type="number" min="0" [(ngModel)]="productEditForm.stockQuantity" [name]="'editStock' + product.id"></label>
                                  <label>Delivery day <input [(ngModel)]="productEditForm.deliveryDay" [name]="'editDelivery' + product.id" placeholder="Mon, Wed, pickup, etc."></label>
                                  <label>Status
                                    <select [(ngModel)]="productEditForm.status" [name]="'editStatus' + product.id">
                                      <option value="draft">Draft</option>
                                      <option value="published" [disabled]="!canPublish(activeVendor())">Published</option>
                                      <option value="paused">Paused</option>
                                    </select>
                                  </label>
                                  <label class="wide-field">Description
                                    <textarea [(ngModel)]="productEditForm.description" [name]="'editDescription' + product.id" rows="3" placeholder="Describe the item"></textarea>
                                  </label>
                                </div>
                                @if (productEditForm.type === 'product') {
                                  <div class="custom-mode-panel edit-custom-mode">
                                    <div>
                                      <strong>Customization setup</strong>
                                      <p class="product-meta">
                                        @if (productHasCustomization(product)) {
                                          {{ productCustomizationFieldCount(product) }} customer input{{ productCustomizationFieldCount(product) === 1 ? '' : 's' }} saved for this product.
                                        } @else {
                                          Add customer text, number, image, color, or dropdown fields for this product.
                                        }
                                      </p>
                                    </div>
                                    <div class="action-cell">
                                      <button class="button-sm" type="button" (click)="openCustomizationBuilder(product)">
                                        {{ productHasCustomization(product) ? 'Edit customization fields' : 'Add customization fields' }}
                                      </button>
                                      @if (customizationBuilder.productId === product.id) {
                                        <span class="status-pill">Customizer open</span>
                                      }
                                    </div>
                                  </div>
                                }
                              </form>
                            </td>
                          </tr>
                        }
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
                      <strong>Publishing paused</strong>
                      <p>{{ publishReadinessMessage() }}</p>
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
                  <div class="document-upload-actions">
                    <label class="button secondary-button file-choice-button" for="serviceImageFile">Choose service photo</label>
                    <input id="serviceImageFile" class="visually-hidden-file" name="serviceImageFile" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" (change)="selectServiceImageFile($event)">
                  </div>
                  <p class="product-meta">{{ imageFileLabel(serviceImageForm, 'Optional JPG, PNG, WEBP, HEIC, or HEIF image up to 8 MB.') }}</p>
                  <button class="button primary-button" type="submit">Create service</button>
                </form>

                <div class="table-wrap">
                  <table class="admin-table">
                    <thead><tr><th>Service</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      @for (service of vendorServices(); track service.id) {
                        <tr>
                          <td>
                            <div class="listing-cell">
                              @if (service.imageUrl) {
                                <img class="listing-thumb" [src]="mediaUrl(service.imageUrl)" [alt]="service.name" loading="lazy" decoding="async">
                              }
                              <div><strong>{{ service.name }}</strong><br><span class="product-meta">{{ service.description || 'No description' }}</span></div>
                            </div>
                          </td>
                          <td>{{ service.category }}</td>
                          <td>{{ money(service.price) }} {{ service.pricingType }}</td>
                          <td><span class="status-pill" [class.warn]="service.status !== 'published'">{{ service.status }}</span></td>
                          <td class="action-cell">
                            @if (service.status === 'published') {
                              <button class="button-sm danger" type="button" (click)="updateServiceStatus(service, 'paused')">Pause</button>
                            } @else {
                              <button class="button-sm" type="button" [disabled]="!canPublish(activeVendor())" (click)="updateServiceStatus(service, 'published')">Publish</button>
                            }
                            <label class="button-sm" [for]="'servicePhoto' + service.id">Photo</label>
                            <input [id]="'servicePhoto' + service.id" class="visually-hidden-file" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" (change)="selectExistingServiceImageFile(service, $event)">
                            @if (serviceImageDrafts[service.id]?.imageDataBase64) {
                              <button class="button-sm" type="button" (click)="uploadServiceImage(service)">Upload photo</button>
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
                  <div class="document-upload-actions">
                    <label class="button secondary-button file-choice-button" for="vendorDocumentImageFile">Choose image</label>
                    <input id="vendorDocumentImageFile" class="visually-hidden-file" name="documentImageFile" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" (change)="selectDocumentFile($event)">
                    <label class="button outline-button file-choice-button" for="vendorDocumentFile">Choose file</label>
                    <input id="vendorDocumentFile" class="visually-hidden-file" name="documentFile" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" (change)="selectDocumentFile($event)">
                  </div>
                  <p class="product-meta">{{ documentFileLabel() }}</p>
                  <button class="button primary-button" type="submit" [disabled]="!documentForm.documentDataBase64">Upload document</button>
                </form>

                <article class="dashboard-card">
                  <h2>Uploaded documents</h2>
                  @for (document of vendorDocuments(); track document.id) {
                    <p>
                      <strong>{{ document.documentType }}</strong><br>
                      {{ document.status }} - {{ documentName(document) }}
                    </p>
                    <button class="button-sm" type="button" (click)="downloadDocument(document)">Download</button>
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
  protected readonly parishOptions = ['Kingston', 'St. Andrew', 'St. Catherine', 'Clarendon', 'Manchester', 'St. Elizabeth', 'Westmoreland', 'Hanover', 'St. James', 'Trelawny', 'St. Ann', 'St. Mary', 'Portland', 'St. Thomas'];
  protected readonly popularLocations = ['Half Way Tree', 'New Kingston', 'Downtown Kingston', 'Portmore', 'Spanish Town', 'May Pen', 'Mandeville', 'Montego Bay', 'Ocho Rios', 'Negril', 'Savanna-la-Mar', 'Linstead', 'Old Harbour', 'Morant Bay'];
  protected readonly socialPlatforms = [
    { value: 'facebook', label: 'Facebook' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'tiktok', label: 'TikTok' },
    { value: 'x', label: 'X' },
    { value: 'youtube', label: 'YouTube' },
    { value: 'website', label: 'Website' }
  ];
  protected readonly customizationPresetOptions = [
    { value: 't_shirt', label: 'T-shirt' },
    { value: 'cup', label: 'Cup' },
    { value: 'bottle', label: 'Water bottle' },
    { value: 'keychain', label: 'Keychain' },
    { value: 'necklace', label: 'Necklace' },
    { value: 'sticker', label: 'Sticker' },
    { value: 'other', label: 'Other item' }
  ];
  protected readonly customizationFieldTypes: Array<{ value: CustomizationFieldType; label: string }> = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'color', label: 'Color' },
    { value: 'select', label: 'Dropdown' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'image', label: 'Image upload' }
  ];
  protected readonly customizationFontOptions: CustomizationFontOption[] = [
    { label: 'Clean sans', value: 'Arial, Helvetica, sans-serif' },
    { label: 'Classic serif', value: 'Georgia, Times New Roman, serif' },
    { label: 'Bold impact', value: 'Impact, Haettenschweiler, Arial Narrow Bold, sans-serif' },
    { label: 'Monospace block', value: 'Courier New, Courier, monospace' },
    { label: 'Rounded modern', value: 'Trebuchet MS, Arial, sans-serif' },
    { label: 'Poppins', value: 'Poppins, Arial, sans-serif', webFont: 'Poppins' },
    { label: 'Montserrat', value: 'Montserrat, Arial, sans-serif', webFont: 'Montserrat' },
    { label: 'Oswald', value: 'Oswald, Arial, sans-serif', webFont: 'Oswald' },
    { label: 'Bebas Neue', value: 'Bebas Neue, Impact, sans-serif', webFont: 'Bebas Neue' },
    { label: 'Playfair Display', value: 'Playfair Display, Georgia, serif', webFont: 'Playfair Display' },
    { label: 'Lora', value: 'Lora, Georgia, serif', webFont: 'Lora' },
    { label: 'Pacifico', value: 'Pacifico, cursive', webFont: 'Pacifico' },
    { label: 'Dancing Script', value: 'Dancing Script, cursive', webFont: 'Dancing Script' }
  ];
  protected readonly customizationFontWeights = [
    { value: '400', label: 'Regular' },
    { value: '600', label: 'Semi bold' },
    { value: '700', label: 'Bold' },
    { value: '800', label: 'Heavy' }
  ];

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

  protected readonly storeThemeOptions = [
    { value: 'street', label: 'Street market' },
    { value: 'island', label: 'Island bright' },
    { value: 'night', label: 'Night market' },
    { value: 'fresh', label: 'Fresh provisions' }
  ];
  protected storeForm = { name: '', slug: '', location: '', addressLine1: '', addressLine2: '', parish: '', latitude: null as number | null, longitude: null as number | null, themeKey: 'street', themePrimaryColor: '#c0552a', themeAccentColor: '#d4a93a', themeBackgroundColor: '#f1e0b5', status: 'draft', summary: '' };
  protected listingForm = { type: 'product', name: '', price: null as number | null, stockQuantity: null as number | null, deliveryDay: '', status: 'draft', description: '' };
  protected editingProductId = '';
  protected productEditForm = { type: 'product', name: '', price: null as number | null, stockQuantity: null as number | null, deliveryDay: '', status: 'draft', description: '' };
  protected serviceForm = { name: '', category: '', price: null as number | null, pricingType: 'Fixed', status: 'draft', description: '' };
  protected mediaForm = { mediaType: 'gallery', url: '' };
  protected socialForm = { platform: 'facebook', label: '', url: '', status: 'active' };
  protected mediaImageForm: ListingImageUpload = this.emptyImageForm();
  protected listingImageForm: ListingImageUpload = this.emptyImageForm();
  protected serviceImageForm: ListingImageUpload = this.emptyImageForm();
  protected documentForm = { documentType: 'Business registration document', documentName: '', documentMimeType: '', documentSizeBytes: 0, documentDataBase64: '' };
  protected discountForm = { name: '', code: '', discountType: 'percent', amount: null as number | null };
  protected payoutForm = { payoutMethod: 'bank_transfer', payoutDetails: '' };
  protected checkoutForm = { amountCoins: null as number | null, payoutMethod: 'bank_transfer', payoutDetails: '' };
  protected selectedDiscountForProduct: Record<string, string> = {};
  protected selectedDiscountForCart: Record<string, string> = {};
  protected productImageDrafts: Record<string, ListingImageUpload> = {};
  protected serviceImageDrafts: Record<string, ListingImageUpload> = {};
  protected listingProductMode: 'standard' | 'customizable' = 'standard';
  protected customizationBuilder: CustomizationBuilderState = this.emptyCustomizationBuilder();
  protected customizationFieldForm = this.emptyCustomizationFieldForm();
  protected customizationFontSearch = '';
  protected fieldToAddToSurface = '';
  protected readonly customizationAutosaveStatus = signal('');
  private customizationDragFieldId = '';
  private customizationEditorAction: 'drag' | 'resize' | '' = '';
  private customizationAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly customFontStorageKey = 'urbanMarketCustomizationRecentFonts';
  protected recentCustomizationFonts: string[] = this.loadRecentCustomizationFonts();
  private readonly loadedWebFonts = new Set<string>();

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
        themeKey: store.themeKey || 'street',
        themePrimaryColor: store.themePrimaryColor || '#c0552a',
        themeAccentColor: store.themeAccentColor || '#d4a93a',
        themeBackgroundColor: store.themeBackgroundColor || '#f1e0b5',
        status: store.status,
        summary: store.summary
      };
    }
    this.mediaForm = { mediaType: 'gallery', url: '' };
    this.socialForm = { platform: 'facebook', label: '', url: '', status: 'active' };
    this.mediaImageForm = this.emptyImageForm();
    this.listingImageForm = this.emptyImageForm();
    this.serviceImageForm = this.emptyImageForm();
    this.productImageDrafts = {};
    this.serviceImageDrafts = {};
    this.listingProductMode = 'standard';
    this.customizationBuilder = this.emptyCustomizationBuilder();
    this.customizationFieldForm = this.emptyCustomizationFieldForm();
    this.resetDocumentForm();
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

  protected customizationSummary(item: any): string {
    const summary = item?.customizationSummary;
    if (Array.isArray(summary)) return summary.filter(Boolean).join(', ');
    if (summary) return String(summary);
    const rows = Array.isArray(item?.customizations) ? item.customizations : [];
    return rows
      .map((row: any) => `${row.fieldLabel || row.fieldKey}: ${row.valueText || ''}`)
      .filter(Boolean)
      .join(', ');
  }

  protected customizationPreviewImage(item: any): string {
    const preview = this.firstCustomizationPreview(item);
    const json = preview?.previewJson || {};
    return this.mediaUrl(String(preview?.previewImageUrl || json.baseImageUrl || json.imageUrl || json.url || ''));
  }

  protected customizationAddOnTotal(item: any): number {
    if (item?.customizationAddOnTotal !== undefined && item?.customizationAddOnTotal !== null) {
      return Number(item.customizationAddOnTotal || 0);
    }
    const rows = Array.isArray(item?.customizations) ? item.customizations : [];
    return rows.reduce((sum: number, row: any) => sum + Number(row?.priceDeltaJmd || 0), 0);
  }

  protected customizationPreviewFields(item: any): any[] {
    const preview = this.firstCustomizationPreview(item);
    const fields = preview?.previewJson?.fields;
    return Array.isArray(fields) ? fields : [];
  }

  protected customizationPreviewPlacement(field: any): any {
    return field?.placement || {
      xPercent: 50,
      yPercent: 50,
      widthPercent: 70,
      heightPercent: 18,
      rotationDegrees: 0,
      fontFamily: 'Arial, Helvetica, sans-serif'
    };
  }

  protected customizationPreviewTransform(field: any): string {
    const placement = this.customizationPreviewPlacement(field);
    return `translate(-50%, -50%) rotate(${Number(placement.rotationDegrees || 0)}deg)`;
  }

  protected orderHasCustomItems(order: any): boolean {
    return Array.isArray(order?.items) && order.items.some((item: any) => this.customizationSummary(item) || (item.customizationPreviews || []).length);
  }

  protected async downloadProductionSheet(order: any): Promise<void> {
    if (!order?.orderId) return;
    try {
      const suffix = order.vendorId ? `?vendorId=${encodeURIComponent(order.vendorId)}` : '';
      const response = await fetch(apiUrl(`/api/orders/${encodeURIComponent(order.orderId)}/production-sheet${suffix}`), {
        headers: this.auth.authHeaders()
      });
      if (!response.ok) {
        throw new Error('Production sheet could not be generated.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `production-${order.orderId}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      this.message.set('Production sheet downloaded.');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Production sheet could not be generated.');
    }
  }

  private firstCustomizationPreview(item: any): any | null {
    const previews = Array.isArray(item?.customizationPreviews) ? item.customizationPreviews : [];
    return previews.find((preview: any) => preview && typeof preview === 'object') || null;
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

  protected storeMedia(): StoreMediaRecord[] {
    const storeId = this.activeStore()?.id;
    return ((this.operations()?.media ?? []) as StoreMediaRecord[])
      .filter((media) => media.storeId === storeId)
      .map((media) => ({ ...media, url: this.mediaUrl(media.url) }));
  }

  protected storeSocialLinks(): StoreSocialLink[] {
    const storeId = this.activeStore()?.id;
    return ((this.operations()?.socialLinks ?? []) as StoreSocialLink[])
      .filter((link) => link.storeId === storeId && link.status !== 'hidden')
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
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
      this.message.set(this.publishReadinessMessage());
      return;
    }
    if (this.listingProductMode === 'customizable' && !this.customizationReadyForSave()) {
      return;
    }
    const hadListingImage = Boolean(this.listingImageForm.imageDataBase64);
    const wasCustomizableListing = this.listingProductMode === 'customizable';
    const product = await this.post('/api/products', { ...this.listingForm, vendorId: this.selectedVendorId }, 'Listing saved.', false);
    if (!product?.id) return;
    let imageSaved = false;
    if (product?.id && hadListingImage) {
      const image = await this.post(`/api/products/${product.id}/images`, {
        ...this.listingImageForm,
        altText: this.listingForm.name || product.name || 'Listing photo'
      }, 'Listing photo uploaded.', false);
      imageSaved = Boolean(image?.id);
    }
    let customizerSaved = false;
    if (wasCustomizableListing) {
      const template = await this.saveCustomizationTemplate(product.id, false);
      customizerSaved = Boolean(template?.id);
    }
    this.listingForm = { type: 'product', name: '', price: null, stockQuantity: null, deliveryDay: '', status: 'draft', description: '' };
    this.listingImageForm = this.emptyImageForm();
    this.listingProductMode = 'standard';
    this.clearCustomizationAutosave();
    this.customizationBuilder = this.emptyCustomizationBuilder();
    this.customizationFieldForm = this.emptyCustomizationFieldForm();
    this.fieldToAddToSurface = '';
    this.customizationAutosaveStatus.set('');
    this.resetFileInput('listingImageFile');
    this.resetFileInput('customSurfaceImageFile');
    await this.loadOperations();
    const photoMessage = hadListingImage ? (imageSaved ? 'photo saved' : 'photo not uploaded') : 'no listing photo';
    this.message.set(wasCustomizableListing
      ? (customizerSaved ? `Listing saved with customizer and ${photoMessage}.` : `Listing saved, but the customizer was not saved and ${photoMessage}.`)
      : hadListingImage
        ? (imageSaved ? 'Listing and photo saved.' : 'Listing saved, but the photo was not uploaded.')
        : 'Listing saved.');
  }

  protected async updateStock(product: any): Promise<void> {
    await this.post(`/api/products/${product.id}/stock`, { stockQuantity: product.stockQuantity }, 'Stock quantity updated.');
  }

  protected async updateProductStatus(product: any, status: string): Promise<void> {
    if (status === 'published' && !this.canPublish(this.activeVendor())) {
      this.message.set(this.publishReadinessMessage());
      return;
    }
    await this.post(`/api/products/${product.id}`, { status }, `Listing marked ${status}.`);
  }

  protected startProductEdit(product: any): void {
    this.editingProductId = product.id;
    this.productEditForm = {
      type: product.type === 'food' ? 'food' : 'product',
      name: product.name || '',
      price: Number(product.originalPrice ?? product.price ?? 0),
      stockQuantity: Number(product.stockQuantity ?? 0),
      deliveryDay: product.deliveryDay || '',
      status: product.status || 'draft',
      description: product.description || ''
    };
    if (this.productHasCustomization(product)) {
      this.openCustomizationBuilder(product);
      this.message.set('Product details and customization fields are open for editing.');
    } else if (this.customizationBuilder.productId && this.customizationBuilder.productId !== product.id) {
      this.closeCustomizationBuilder();
    }
  }

  protected cancelProductEdit(): void {
    this.editingProductId = '';
    this.productEditForm = { type: 'product', name: '', price: null, stockQuantity: null, deliveryDay: '', status: 'draft', description: '' };
  }

  protected async saveProductEdit(product: any): Promise<void> {
    if (this.productEditForm.status === 'published' && !this.canPublish(this.activeVendor())) {
      this.message.set(this.publishReadinessMessage());
      return;
    }
    const updated = await this.post(`/api/products/${product.id}`, {
      ...this.productEditForm,
      price: Number(this.productEditForm.price || 0),
      stockQuantity: Math.max(0, Math.floor(Number(this.productEditForm.stockQuantity || 0)))
    }, 'Listing details updated.');
    if (updated) {
      this.cancelProductEdit();
    }
  }

  protected productCustomizationTemplate(product: any): any | null {
    return this.customizationTemplateForProduct(product.id);
  }

  protected productHasCustomization(product: any): boolean {
    return Boolean(product?.isCustomizable || product?.customizationTemplateId || this.productCustomizationTemplate(product));
  }

  protected productCustomizationFieldCount(product: any): number {
    return Number(this.productCustomizationTemplate(product)?.fields?.length || 0);
  }

  protected setListingProductMode(mode: string): void {
    this.listingProductMode = mode === 'customizable' ? 'customizable' : 'standard';
    if (this.listingProductMode === 'customizable') {
      this.customizationBuilder = this.builderWithPreset('t_shirt', this.listingPreviewName());
      this.customizationAutosaveStatus.set('');
      return;
    }
    if (!this.customizationBuilder.productId) {
      this.clearCustomizationAutosave();
      this.customizationBuilder = this.emptyCustomizationBuilder();
      this.customizationFieldForm = this.emptyCustomizationFieldForm();
      this.fieldToAddToSurface = '';
      this.customizationAutosaveStatus.set('');
    }
  }

  protected listingTypeChanged(type: string): void {
    this.listingForm.type = type === 'food' ? 'food' : 'product';
    if (this.listingForm.type !== 'product') {
      this.listingProductMode = 'standard';
      if (!this.customizationBuilder.productId) {
        this.clearCustomizationAutosave();
        this.customizationBuilder = this.emptyCustomizationBuilder();
        this.customizationFieldForm = this.emptyCustomizationFieldForm();
        this.fieldToAddToSurface = '';
        this.customizationAutosaveStatus.set('');
      }
    }
  }

  protected showCustomizationBuilder(): boolean {
    return this.listingProductMode === 'customizable' || Boolean(this.customizationBuilder.productId);
  }

  protected customizationTemplateForProduct(productId: string): any | null {
    return (this.operations()?.customizationTemplates ?? []).find((template: any) => template.productId === productId) ?? null;
  }

  protected openCustomizationBuilder(product: any): void {
    const template = this.customizationTemplateForProduct(product.id);
    this.listingProductMode = 'standard';
    this.customizationBuilder = this.customizationBuilderFromTemplate(product, template);
    this.customizationFieldForm = this.emptyCustomizationFieldForm();
    this.fieldToAddToSurface = '';
    this.customizationAutosaveStatus.set(template ? 'Autosave ready' : '');
    this.resetFileInput('customSurfaceImageFile');
    this.message.set(template ? 'Customizer loaded for editing.' : 'Add a base image and customer fields for this product.');
  }

  protected closeCustomizationBuilder(): void {
    this.clearCustomizationAutosave();
    this.customizationBuilder = this.emptyCustomizationBuilder();
    this.customizationFieldForm = this.emptyCustomizationFieldForm();
    this.fieldToAddToSurface = '';
    this.customizationAutosaveStatus.set('');
    this.customizationDragFieldId = '';
    this.customizationEditorAction = '';
    this.resetFileInput('customSurfaceImageFile');
  }

  protected customizationPresetChanged(value: string): void {
    this.customizationBuilder.productType = value || 'other';
    this.applyCustomizationPreset(false, true);
    this.scheduleCustomizationAutosave(350);
  }

  protected applyCustomizationPreset(showMessage = true, replaceFields = false): void {
    const preset = this.customizationPresetConfig(this.customizationBuilder.productType);
    const previousSurfaces = [...this.customizationBuilder.surfaces];
    const existingByKey = new Map(previousSurfaces.map((surface) => [surface.surfaceKey, surface]));
    const previousSurfaceById = new Map(previousSurfaces.map((surface) => [surface.id, surface]));
    const surfaces = preset.surfaces.map((surface: CustomizationPresetSurface, index: number) => {
      const existing = existingByKey.get(surface.surfaceKey);
      return {
        ...(existing || {
          id: this.newDraftId(),
          baseImageUrl: '',
          upload: this.emptyImageForm()
        }),
        name: existing?.name || surface.name,
        surfaceKey: surface.surfaceKey,
        widthPx: existing?.widthPx || surface.widthPx,
        heightPx: existing?.heightPx || surface.heightPx,
        sortOrder: index
      };
    });
    this.customizationBuilder.surfaces = surfaces;
    this.customizationBuilder.selectedSurfaceId = surfaces[0]?.id || '';
    this.customizationBuilder.surface = surfaces[0];
    this.customizationBuilder.instructions = preset.instructions;
    this.fieldToAddToSurface = '';
    if (replaceFields || !this.customizationBuilder.fields.length) {
      this.customizationBuilder.fields = preset.fields.map((field: CustomizationPresetField, index: number) => this.fieldDraftFromPreset(field, index, surfaces));
      this.customizationBuilder.selectedFieldId = this.customizationBuilder.fields[0]?.localId || '';
    } else {
      for (const field of this.customizationBuilder.fields) {
        const rebuilt: Record<string, CustomizationPlacementDraft> = {};
        for (const surface of surfaces) {
          const previous = Object.entries(field.placementsBySurface || {}).find(([surfaceId]) => previousSurfaceById.get(surfaceId)?.surfaceKey === surface.surfaceKey)?.[1]
            || field.placementsBySurface?.[surface.id]
            || (surface.id === this.customizationBuilder.selectedSurfaceId ? field.placement : null);
          if (previous) {
            rebuilt[surface.id] = { ...previous, id: previous.id || this.newDraftId() };
          }
        }
        if (!Object.keys(rebuilt).length && surfaces[0]) {
          rebuilt[surfaces[0].id] = this.defaultPlacement(0);
        }
        field.placementsBySurface = rebuilt;
        field.placement = rebuilt[this.customizationBuilder.selectedSurfaceId] || Object.values(rebuilt)[0] || this.defaultPlacement(0);
      }
    }
    this.syncSelectedFieldPlacement();
    this.scheduleCustomizationAutosave(350);
    if (showMessage) this.message.set(replaceFields ? 'Product preset applied. Review the base image and field positions before saving.' : 'Preset surfaces applied. Upload a blank image for each surface before saving.');
  }

  protected async saveCustomizationBuilder(): Promise<void> {
    if (!this.customizationBuilder.productId) {
      this.message.set('This customizer will save when the new listing is created.');
      return;
    }
    if (!this.customizationReadyForSave()) {
      return;
    }
    this.clearCustomizationAutosave();
    await this.saveCustomizationTemplate(this.customizationBuilder.productId, true);
    this.customizationAutosaveStatus.set('Saved manually.');
  }

  protected async selectCustomizationSurfaceImage(event: Event): Promise<void> {
    await this.readImageFile(event, (image) => {
      this.customizationBuilder.surface.upload = image;
      if (image.imageDataBase64) {
        this.customizationBuilder.surface.baseImageUrl = '';
      }
    });
    this.scheduleCustomizationAutosave(500);
  }

  protected selectCustomizationSurface(surfaceId: string): void {
    const surface = this.customizationBuilder.surfaces.find((item) => item.id === surfaceId);
    if (!surface) return;
    this.customizationBuilder.selectedSurfaceId = surface.id;
    this.customizationBuilder.surface = surface;
    this.fieldToAddToSurface = '';
    this.syncSelectedFieldPlacement();
  }

  protected addCustomizationSurface(): void {
    const index = this.customizationBuilder.surfaces.length + 1;
    const surface = {
      id: this.newDraftId(),
      name: `Surface ${index}`,
      surfaceKey: `surface_${index}`,
      baseImageUrl: '',
      widthPx: 900,
      heightPx: 900,
      sortOrder: index - 1,
      upload: this.emptyImageForm()
    };
    this.customizationBuilder.surfaces = [...this.customizationBuilder.surfaces, surface];
    this.selectCustomizationSurface(surface.id);
    this.scheduleCustomizationAutosave();
  }

  protected removeActiveCustomizationSurface(): void {
    if (this.customizationBuilder.surfaces.length <= 1) return;
    const removeId = this.customizationBuilder.selectedSurfaceId;
    this.customizationBuilder.surfaces = this.customizationBuilder.surfaces.filter((surface) => surface.id !== removeId);
    for (const field of this.customizationBuilder.fields) {
      delete field.placementsBySurface[removeId];
      field.placement = field.placementsBySurface[this.customizationBuilder.surfaces[0].id] || Object.values(field.placementsBySurface)[0] || this.defaultPlacement(0);
    }
    this.customizationBuilder.fields = this.customizationBuilder.fields.filter((field) => Object.keys(field.placementsBySurface || {}).length);
    this.selectCustomizationSurface(this.customizationBuilder.surfaces[0].id);
    this.scheduleCustomizationAutosave();
  }

  protected customizationSurfacePreviewUrl(surface = this.customizationBuilder.surface): string {
    const upload = surface.upload;
    if (upload.imageDataBase64) {
      return `data:${upload.imageMimeType || 'image/jpeg'};base64,${upload.imageDataBase64}`;
    }
    return this.mediaUrl(surface.baseImageUrl);
  }

  protected customizationSurfaceLabel(): string {
    const upload = this.customizationBuilder.surface.upload;
    if (upload.imageName) {
      return this.imageFileLabel(upload, '');
    }
    return this.customizationBuilder.surface.baseImageUrl ? 'Base image saved. Choose a new image to replace it.' : 'Upload a blank JPG, PNG, WEBP, HEIC, or HEIF product image up to 8 MB.';
  }

  protected customizationPresetSurfaceHint(): string {
    const preset = this.customizationPresetConfig(this.customizationBuilder.productType);
    return `${preset.label}: ${preset.surfaces.map((surface: CustomizationPresetSurface) => `${surface.name} ${surface.widthPx}x${surface.heightPx}`).join(', ')}`;
  }

  protected addCustomizationField(): void {
    const label = this.customizationFieldForm.label.trim();
    if (!label) {
      this.message.set('Add a field label first.');
      return;
    }
    if (this.customizationFieldForm.fieldType === 'select' && !this.optionLabelsFromText(this.customizationFieldForm.optionsText).length) {
      this.message.set('Dropdown fields need at least one option.');
      return;
    }
    const field = {
      ...this.customizationFieldForm,
      id: this.newDraftId(),
      localId: this.newDraftId(),
      fieldKey: this.customizationKey(label),
      label,
      defaultValue: this.defaultCustomizationValue(this.customizationFieldForm),
      placement: this.defaultPlacement(this.customizationBuilder.fields.length),
      placementsBySurface: {
        [this.customizationBuilder.selectedSurfaceId]: this.defaultPlacement(this.customizationBuilder.fields.length)
      }
    };
    field.placement = field.placementsBySurface[this.customizationBuilder.selectedSurfaceId];
    this.customizationBuilder.fields = [...this.customizationBuilder.fields, field];
    this.customizationBuilder.selectedFieldId = field.localId;
    this.customizationFieldForm = this.emptyCustomizationFieldForm();
    this.scheduleCustomizationAutosave();
  }

  protected selectCustomizationField(localId: string): void {
    this.customizationBuilder.selectedFieldId = localId;
    this.syncSelectedFieldPlacement();
  }

  protected selectedCustomizationField(): CustomizationFieldDraft | null {
    const fieldsOnSurface = this.customizationFieldsForActiveSurface();
    const field = fieldsOnSurface.find((item) => item.localId === this.customizationBuilder.selectedFieldId) ?? fieldsOnSurface[0] ?? null;
    if (!field) return null;
    this.customizationBuilder.selectedFieldId = field.localId;
    field.placement = field.placementsBySurface[this.customizationBuilder.selectedSurfaceId];
    return field;
  }

  protected removeCustomizationField(localId: string): void {
    this.customizationBuilder.fields = this.customizationBuilder.fields.filter((field) => field.localId !== localId);
    this.customizationBuilder.selectedFieldId = this.customizationFieldsForActiveSurface()[0]?.localId || '';
    this.scheduleCustomizationAutosave();
  }

  protected removeCustomizationFieldFromActiveSurface(localId: string): void {
    const surfaceId = this.customizationBuilder.selectedSurfaceId;
    const field = this.customizationBuilder.fields.find((item) => item.localId === localId);
    if (!field) return;
    delete field.placementsBySurface[surfaceId];
    const remainingSurfaceIds = Object.keys(field.placementsBySurface || {});
    if (!remainingSurfaceIds.length) {
      this.customizationBuilder.fields = this.customizationBuilder.fields.filter((item) => item.localId !== localId);
    } else {
      field.placement = field.placementsBySurface[remainingSurfaceIds[0]];
    }
    this.customizationBuilder.selectedFieldId = this.customizationFieldsForActiveSurface()[0]?.localId || '';
    this.scheduleCustomizationAutosave();
  }

  protected customizationFieldsAwayFromActiveSurface(): CustomizationFieldDraft[] {
    const surfaceId = this.customizationBuilder.selectedSurfaceId;
    return this.customizationBuilder.fields.filter((field) => !field.placementsBySurface?.[surfaceId]);
  }

  protected addExistingCustomizationFieldToActiveSurface(): void {
    const field = this.customizationBuilder.fields.find((item) => item.localId === this.fieldToAddToSurface);
    if (!field) {
      this.message.set('Choose an existing input first.');
      return;
    }
    const surfaceId = this.customizationBuilder.selectedSurfaceId;
    field.placementsBySurface = field.placementsBySurface || {};
    field.placementsBySurface[surfaceId] = this.defaultPlacement(this.customizationFieldsForActiveSurface().length);
    field.placement = field.placementsBySurface[surfaceId];
    this.customizationBuilder.selectedFieldId = field.localId;
    this.fieldToAddToSurface = '';
    this.scheduleCustomizationAutosave();
  }

  protected fieldSurfaceCount(field: CustomizationFieldDraft): number {
    return Object.keys(field.placementsBySurface || {}).length;
  }

  protected customizationFieldsForActiveSurface(): CustomizationFieldDraft[] {
    const surfaceId = this.customizationBuilder.selectedSurfaceId;
    return this.customizationBuilder.fields
      .filter((field) => Boolean(field.placementsBySurface?.[surfaceId]))
      .map((field) => {
        field.placement = field.placementsBySurface[surfaceId];
        return field;
      });
  }

  protected activePlacement(field: CustomizationFieldDraft): CustomizationPlacementDraft {
    const placement = field.placementsBySurface?.[this.customizationBuilder.selectedSurfaceId] || field.placement || this.defaultPlacement(0);
    field.placement = placement;
    return placement;
  }

  private ensurePlacementForActiveSurface(field: CustomizationFieldDraft): CustomizationPlacementDraft {
    const surfaceId = this.customizationBuilder.selectedSurfaceId;
    field.placementsBySurface = field.placementsBySurface || {};
    if (!field.placementsBySurface[surfaceId]) {
      field.placementsBySurface[surfaceId] = this.defaultPlacement(this.customizationBuilder.fields.indexOf(field));
    }
    field.placement = field.placementsBySurface[surfaceId];
    return field.placement;
  }

  private syncSelectedFieldPlacement(): void {
    const selected = this.customizationBuilder.fields.find((field) => field.localId === this.customizationBuilder.selectedFieldId);
    if (selected?.placementsBySurface?.[this.customizationBuilder.selectedSurfaceId]) {
      selected.placement = selected.placementsBySurface[this.customizationBuilder.selectedSurfaceId];
      return;
    }
    this.customizationBuilder.selectedFieldId = this.customizationFieldsForActiveSurface()[0]?.localId || '';
  }

  protected customizationFieldChanged(field: CustomizationFieldDraft): void {
    field.fieldType = this.asCustomizationFieldType(field.fieldType);
    if (field.fieldType === 'select' && !this.optionLabelsFromText(field.optionsText).length) {
      field.optionsText = 'Option 1, Option 2';
      field.defaultValue = 'Option 1';
    }
    if (field.fieldType !== 'select') {
      field.optionsText = '';
    }
    if (field.fieldType === 'color' && !field.defaultValue) {
      field.defaultValue = '#ff7a00';
    }
    if (field.fieldType === 'number' && !field.defaultValue) {
      field.defaultValue = '00';
    }
    if (field.fieldType === 'checkbox' && !field.defaultValue) {
      field.defaultValue = 'true';
    }
    if (field.fieldType === 'image') {
      field.defaultValue = '';
      field.placeholder = field.placeholder || 'Upload logo or artwork';
    }
    this.scheduleCustomizationAutosave();
  }

  protected setCustomizationTextAlign(field: CustomizationFieldDraft, alignment: string): void {
    this.ensurePlacementForActiveSurface(field).textAlign = ['left', 'center', 'right'].includes(alignment) ? alignment : 'center';
    this.scheduleCustomizationAutosave();
  }

  protected customizationFieldUsesFont(field: CustomizationFieldDraft): boolean {
    return field.fieldType === 'text' || field.fieldType === 'number';
  }

  protected selectCustomizationFont(field: CustomizationFieldDraft, value: string): void {
    const fontFamily = this.fontFamilyValue(value);
    this.ensurePlacementForActiveSurface(field).fontFamily = fontFamily;
    if (fontFamily) {
      this.rememberCustomizationFont(fontFamily);
      this.ensureWebFont(fontFamily);
    }
    this.scheduleCustomizationAutosave();
  }

  protected addSearchedCustomizationFont(field: CustomizationFieldDraft): void {
    const fontFamily = this.fontFamilyValue(this.customizationFontSearch);
    if (!fontFamily) {
      this.message.set('Type a font name before adding it.');
      return;
    }
    this.ensurePlacementForActiveSurface(field).fontFamily = fontFamily;
    this.rememberCustomizationFont(fontFamily);
    this.ensureWebFont(fontFamily);
    this.customizationFontSearch = '';
    this.scheduleCustomizationAutosave();
  }

  protected customizationFieldFontFamily(field: CustomizationFieldDraft): string {
    const fontFamily = this.activePlacement(field).fontFamily || 'Arial, Helvetica, sans-serif';
    this.ensureWebFont(fontFamily);
    return fontFamily;
  }

  protected customizationPreviewFontFamily(field: any): string {
    const placement = this.customizationPreviewPlacement(field);
    const fontFamily = placement.fontFamily || 'Arial, Helvetica, sans-serif';
    this.ensureWebFont(fontFamily);
    return fontFamily;
  }

  protected fontLabel(value: string): string {
    return this.customizationFontOptions.find((font) => font.value === value)?.label || this.primaryFontName(value);
  }

  protected allCustomizationFontSuggestions(): CustomizationFontOption[] {
    const recent = this.recentCustomizationFonts.map((font) => ({
      label: this.fontLabel(font),
      value: font,
      webFont: this.primaryFontName(font)
    }));
    return [...recent, ...this.customizationFontOptions];
  }

  protected customizationFieldTypeLabel(type: CustomizationFieldType): string {
    return this.customizationFieldTypes.find((item) => item.value === type)?.label || type;
  }

  protected customizationFieldPriceLabel(field: CustomizationFieldDraft): string {
    const fieldAmount = Number(field.priceDeltaJmd || 0);
    const optionAmount = this.optionRecordsFromText(field.optionsText).reduce((sum, option) => sum + Number(option.priceDeltaJmd || 0), 0);
    const total = fieldAmount + optionAmount;
    return total > 0 ? ` - add-ons from ${this.money(total)}` : '';
  }

  protected customizationPreviewValue(field: CustomizationFieldDraft): string {
    if (field.fieldType === 'checkbox') {
      return field.defaultValue === 'true' ? field.label : `${field.label}: yes`;
    }
    if (field.fieldType === 'color') {
      return field.defaultValue || '#ff7a00';
    }
    if (field.fieldType === 'select') {
      return this.optionLabelsFromText(field.optionsText)[0] || field.defaultValue || field.label;
    }
    if (field.fieldType === 'image') {
      return field.placeholder || 'Customer image area';
    }
    return field.defaultValue || field.placeholder || field.label;
  }

  protected customizationFieldTransform(field: CustomizationFieldDraft): string {
    const placement = this.activePlacement(field);
    return `translate(-50%, -50%) rotate(${Number(placement.rotationDegrees || 0)}deg)`;
  }

  protected customizationFieldFontSize(field: CustomizationFieldDraft): number {
    return Math.max(11, Math.min(40, Number(this.activePlacement(field).fontSizePercent || 14) * 1.2));
  }

  protected customizationPrintWarnings(): string[] {
    return this.customizationFieldsForActiveSurface()
      .map((field) => {
        const placement = this.activePlacement(field);
        const left = placement.xPercent - placement.widthPercent / 2;
        const right = placement.xPercent + placement.widthPercent / 2;
        const top = placement.yPercent - placement.heightPercent / 2;
        const bottom = placement.yPercent + placement.heightPercent / 2;
        return left < 4 || right > 96 || top < 4 || bottom > 96
          ? `${field.label || 'Field'} is close to the print edge on ${this.customizationBuilder.surface.name}.`
          : '';
      })
      .filter(Boolean)
      .slice(0, 4);
  }

  protected startCustomizationDrag(event: PointerEvent, localId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.customizationDragFieldId = localId;
    this.customizationEditorAction = 'drag';
    this.selectCustomizationField(localId);
  }

  protected startCustomizationResize(event: PointerEvent, localId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.customizationDragFieldId = localId;
    this.customizationEditorAction = 'resize';
    this.selectCustomizationField(localId);
  }

  protected dragCustomizationField(event: PointerEvent): void {
    if (!this.customizationDragFieldId) return;
    const field = this.customizationBuilder.fields.find((item) => item.localId === this.customizationDragFieldId);
    if (!field) return;
    const placement = this.ensurePlacementForActiveSurface(field);
    const canvas = event.currentTarget as HTMLElement;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pointerX = this.clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
    const pointerY = this.clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
    if (this.customizationEditorAction === 'resize') {
      placement.widthPercent = this.clamp(Math.abs(pointerX - placement.xPercent) * 2, 8, 100);
      placement.heightPercent = this.clamp(Math.abs(pointerY - placement.yPercent) * 2, 4, 60);
      return;
    }
    placement.xPercent = pointerX;
    placement.yPercent = pointerY;
  }

  protected endCustomizationDrag(): void {
    const hadDrag = Boolean(this.customizationDragFieldId);
    this.customizationDragFieldId = '';
    this.customizationEditorAction = '';
    if (hadDrag) {
      this.scheduleCustomizationAutosave(450);
    }
  }

  protected async createService(): Promise<void> {
    if (this.serviceForm.status === 'published' && !this.canPublish(this.activeVendor())) {
      this.message.set(this.publishReadinessMessage());
      return;
    }
    const hadServiceImage = Boolean(this.serviceImageForm.imageDataBase64);
    const service = await this.post('/api/services', { ...this.serviceForm, vendorId: this.selectedVendorId }, 'Service saved.', false);
    if (!service?.id) return;
    let imageSaved = false;
    if (service?.id && hadServiceImage) {
      const image = await this.post(`/api/services/${service.id}/images`, {
        ...this.serviceImageForm,
        altText: this.serviceForm.name || service.name || 'Service photo'
      }, 'Service photo uploaded.', false);
      imageSaved = Boolean(image?.id);
    }
    this.serviceForm = { name: '', category: '', price: null, pricingType: 'Fixed', status: 'draft', description: '' };
    this.serviceImageForm = this.emptyImageForm();
    this.resetFileInput('serviceImageFile');
    await this.loadOperations();
    this.message.set(hadServiceImage ? (imageSaved ? 'Service and photo saved.' : 'Service saved, but the photo was not uploaded.') : 'Service saved.');
  }

  protected async updateServiceStatus(service: any, status: string): Promise<void> {
    if (status === 'published' && !this.canPublish(this.activeVendor())) {
      this.message.set(this.publishReadinessMessage());
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
    await this.post(`/api/stores/${store.id}/media`, {
      ...this.mediaForm,
      ...this.mediaImageForm,
      altText: this.mediaForm.mediaType === 'logo' ? `${store.name} logo` : `${store.name} media`
    }, 'Store media added.');
    this.mediaForm = { mediaType: 'gallery', url: '' };
    this.mediaImageForm = this.emptyImageForm();
    this.resetFileInput('storeMediaImageFile');
  }

  protected async saveSocialLink(): Promise<void> {
    const store = this.activeStore();
    if (!store) return;
    await this.post(`/api/stores/${store.id}/social-links`, this.socialForm, 'Social account saved.');
    this.socialForm = { platform: this.socialForm.platform, label: '', url: '', status: 'active' };
  }

  protected async removeSocialLink(link: StoreSocialLink): Promise<void> {
    const store = this.activeStore();
    if (!store || !link.platform) return;
    await this.request(`/api/stores/${store.id}/social-links/${encodeURIComponent(link.platform)}`, 'DELETE', null, 'Social account removed.');
  }

  protected selectStoreMediaFile(event: Event): void {
    this.readImageFile(event, (image) => {
      this.mediaImageForm = image;
      if (image.imageDataBase64) this.mediaForm.url = '';
    });
  }

  protected selectListingImageFile(event: Event): void {
    this.readImageFile(event, (image) => {
      this.listingImageForm = image;
    });
  }

  protected selectServiceImageFile(event: Event): void {
    this.readImageFile(event, (image) => {
      this.serviceImageForm = image;
    });
  }

  protected selectProductImageFile(product: any, event: Event): void {
    this.readImageFile(event, (image) => {
      this.productImageDrafts = { ...this.productImageDrafts, [product.id]: image };
    });
  }

  protected selectExistingServiceImageFile(service: any, event: Event): void {
    this.readImageFile(event, (image) => {
      this.serviceImageDrafts = { ...this.serviceImageDrafts, [service.id]: image };
    });
  }

  protected async uploadProductImage(product: any): Promise<void> {
    const image = this.productImageDrafts[product.id];
    if (!image?.imageDataBase64) {
      this.message.set('Choose a product photo before uploading.');
      return;
    }
    const result = await this.post(`/api/products/${product.id}/images`, {
      ...image,
      altText: product.name || 'Product photo',
      makePrimary: true
    }, 'Product photo uploaded.');
    if (!result?.id) return;
    delete this.productImageDrafts[product.id];
    this.productImageDrafts = { ...this.productImageDrafts };
    this.resetFileInput(`productPhoto${product.id}`);
  }

  protected async useProductCustomizerImage(product: any): Promise<void> {
    const template = this.customizationTemplateForProduct(product.id);
    const surface = (template?.surfaces || []).find((item: any) => item.baseImageUrl || item.imageUrl || item.url);
    const payload = this.productImagePayloadFromCustomizationSurface(surface, product.name || 'Product');
    if (!payload) {
      this.message.set('This product customizer does not have a saved base image yet.');
      return;
    }
    await this.post(`/api/products/${product.id}/images`, payload, 'Customizer photo is now the listing photo.');
  }

  protected async useCustomizationSurfaceAsProductImage(): Promise<void> {
    const productId = this.customizationBuilder.productId;
    if (!productId) {
      this.message.set('Create the listing before using a customizer image as the product photo.');
      return;
    }
    const product = this.vendorProducts().find((item) => item.id === productId);
    const payload = this.productImagePayloadFromCustomizationSurface(this.customizationBuilder.surface, product?.name || this.customizationBuilder.productName || 'Product');
    if (!payload) {
      this.message.set('Choose or save a base image for this customizer side first.');
      return;
    }
    await this.post(`/api/products/${productId}/images`, payload, 'Current customizer side is now the listing photo.');
  }

  protected async uploadServiceImage(service: any): Promise<void> {
    const image = this.serviceImageDrafts[service.id];
    if (!image?.imageDataBase64) {
      this.message.set('Choose a service photo before uploading.');
      return;
    }
    const result = await this.post(`/api/services/${service.id}/images`, {
      ...image,
      altText: service.name || 'Service photo'
    }, 'Service photo uploaded.');
    if (!result?.id) return;
    delete this.serviceImageDrafts[service.id];
    this.serviceImageDrafts = { ...this.serviceImageDrafts };
    this.resetFileInput(`servicePhoto${service.id}`);
  }

  protected imageFileLabel(image: ListingImageUpload, fallback: string): string {
    if (!image.imageName) return fallback;
    const kb = image.imageSizeBytes / 1024;
    const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
    return `${image.imageName} selected (${size})`;
  }

  protected listingPreviewCategory(): string {
    return this.listingForm.type === 'food' ? 'Food' : 'Products';
  }

  protected listingPreviewName(): string {
    return this.listingForm.name || 'Listing name';
  }

  protected listingPreviewPrice(): number {
    return Number(this.listingForm.price || 0);
  }

  protected listingPreviewImage(): string {
    if (!this.listingImageForm.imageDataBase64) return '';
    const mime = this.listingImageForm.imageMimeType || 'image/jpeg';
    return `data:${mime};base64,${this.listingImageForm.imageDataBase64}`;
  }

  protected mediaUrl(value?: string): string {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(data:|blob:)/i.test(text)) return text;
    if (/^https?:\/\//i.test(text)) {
      try {
        const parsed = new URL(text);
        if (parsed.pathname.startsWith('/uploads/')) {
          return apiUrl(`/api${parsed.pathname}${parsed.search}`);
        }
      } catch {
        return text;
      }
      return text;
    }
    const path = text.startsWith('/api/')
      ? text
      : text.startsWith('/uploads/')
        ? `/api${text}`
        : text.startsWith('uploads/')
          ? `/api/${text}`
          : text;
    return path.startsWith('/api/') ? apiUrl(path) : path;
  }

  protected async uploadDocument(): Promise<void> {
    await this.post('/api/vendor-documents', { ...this.documentForm, vendorId: this.selectedVendorId }, 'Registration document uploaded for admin review.');
    this.resetDocumentForm();
    this.resetDocumentInputs();
  }

  protected selectDocumentFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.documentForm = {
      ...this.documentForm,
      documentName: '',
      documentMimeType: '',
      documentSizeBytes: 0,
      documentDataBase64: ''
    };
    if (!file) return;

    const allowedTypes = [
      'application/msword',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/heic',
      'image/heif',
      'image/jpeg',
      'image/png',
      'image/webp'
    ];
    const allowedExtensions = ['.doc', '.docx', '.heic', '.heif', '.jpeg', '.jpg', '.pdf', '.png', '.webp'];
    const lowerName = file.name.toLowerCase();
    if (!allowedTypes.includes(file.type) && !allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
      this.message.set('Upload a PDF, image, Word document, or DOCX file.');
      input.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.message.set('Registration document must be 8 MB or smaller.');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      this.documentForm = {
        ...this.documentForm,
        documentName: file.name,
        documentMimeType: file.type || this.mimeTypeFromFileName(file.name),
        documentSizeBytes: file.size,
        documentDataBase64: value.includes(',') ? value.split(',')[1] : value
      };
    };
    reader.onerror = () => {
      this.message.set('Document could not be read. Try selecting it again.');
      input.value = '';
    };
    reader.readAsDataURL(file);
  }

  protected documentFileLabel(): string {
    if (!this.documentForm.documentName) return 'PDF, image, Word, or DOCX file up to 8 MB.';
    const kb = this.documentForm.documentSizeBytes / 1024;
    const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
    return `${this.documentForm.documentName} selected (${size})`;
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

  protected async requestAssistance(): Promise<void> {
    const store = this.activeStore();
    if (!store) return;
    await this.post(`/api/vendors/${store.slug}/registration-assistance`, {}, 'Registration assistance requested.');
  }

  protected async updateOrderFulfillment(order: any, fulfillmentStatus: string, orderItemId: string | null = null): Promise<void> {
    await this.post(`/api/orders/${order.orderId}/status`, {
      vendorId: order.vendorId,
      fulfillmentStatus,
      orderItemId
    }, orderItemId ? `Order item marked ${fulfillmentStatus}.` : `Order ${order.orderId} marked ${fulfillmentStatus}.`);
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
    const slug = this.activeStore()?.slug || this.storeForm.slug || '';
    if (typeof window === 'undefined') return `/vendor/${slug}`;
    return `${window.location.origin}/vendor/${slug}`;
  }

  protected shareStoreName(): string {
    return this.activeStore()?.name || this.storeForm.name || 'this Urban Market JA store';
  }

  protected whatsappShare(): string {
    return `https://wa.me/?text=${encodeURIComponent(`Check out ${this.shareStoreName()} on Urban Market JA: ${this.storeUrl()}`)}`;
  }

  protected facebookShare(): string {
    return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(this.storeUrl())}`;
  }

  protected coordinateStatus(): string {
    const latitude = this.storeForm.latitude;
    const longitude = this.storeForm.longitude;
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
      return 'No map coordinates saved yet.';
    }
    return `Map point set: ${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;
  }

  protected socialIcon(platform: string): string {
    return {
      facebook: 'f',
      instagram: 'IG',
      whatsapp: 'WA',
      tiktok: 'TT',
      x: 'X',
      youtube: 'YT',
      website: 'www'
    }[platform] || 'link';
  }

  protected socialName(platform: string): string {
    return this.socialPlatforms.find((item) => item.value === platform)?.label || platform;
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
    const store = this.activeStore();
    if (!store) {
      return 'Create a store profile before products, foods, or services can appear publicly.';
    }
    if (this.isStorePaused(store)) {
      return 'Resume this store before products, foods, or services can appear publicly.';
    }
    if (vendor.subscriptionStatus === 'past_due') {
      return 'Subscription is past due. Product publishing is paused until payment is restored.';
    }
    if (vendor.subscriptionStatus !== 'active') {
      return 'Subscription must be active before this store and its listings can appear publicly.';
    }
    if (this.isStarterPlan(vendor)) {
      return 'Starter plan is for private setup only. Select an active Growth or Pro plan before this store can appear publicly.';
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
    const store = this.activeStore();
    if (!store || this.isStorePaused(store)) return 'notice';
    if (vendor.subscriptionStatus === 'past_due') return 'critical';
    if (vendor.subscriptionStatus !== 'active' || this.isStarterPlan(vendor)) return 'notice';
    if (vendor.registrationStatus === 'registered') return 'ok';
    const daysRemaining = this.daysLeft(vendor);
    return daysRemaining <= 7 ? 'critical' : daysRemaining <= 90 ? 'warning' : 'notice';
  }

  protected canPublish(vendor: VendorRecord | null): boolean {
    const store = this.activeStore();
    return !!vendor
      && !!store
      && !this.isStorePaused(store)
      && vendor.subscriptionStatus === 'active'
      && vendor.registrationStatus === 'registered'
      && !this.isStarterPlan(vendor);
  }

  protected publishReadinessMessage(): string {
    const vendor = this.activeVendor();
    const store = this.activeStore();
    if (!vendor) return 'Vendor data is still loading.';
    if (!store) return 'Create and save a store profile before publishing.';
    if (this.isStorePaused(store)) return 'Resume this store before publishing or showing listings in the marketplace.';
    if (vendor.subscriptionStatus === 'past_due') return 'Subscription is past due. Restore the subscription before publishing.';
    if (vendor.subscriptionStatus !== 'active') return 'Activate a vendor subscription before publishing.';
    if (this.isStarterPlan(vendor)) return 'Starter plan is private setup only. Choose Growth or Pro before publishing.';
    if (vendor.registrationStatus !== 'registered') return 'Complete business registration before publishing.';
    return 'Publishing is enabled for this store.';
  }

  private isStarterPlan(vendor: VendorRecord | null): boolean {
    const plan = String(vendor?.subscriptionPlanCode || vendor?.subscriptionPlan || '').toLowerCase();
    return plan === 'starter' || plan.includes('starter');
  }

  private isStorePaused(store: VendorStore | null): boolean {
    return ['paused', 'suspended'].includes(String(store?.status || '').toLowerCase());
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

  private resetDocumentForm(): void {
    this.documentForm = {
      documentType: this.documentForm.documentType || 'Business registration document',
      documentName: '',
      documentMimeType: '',
      documentSizeBytes: 0,
      documentDataBase64: ''
    };
  }

  private resetDocumentInputs(): void {
    if (typeof document === 'undefined') return;
    for (const id of ['vendorDocumentFile', 'vendorDocumentImageFile']) {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) input.value = '';
    }
  }

  private productImagePayloadFromCustomizationSurface(surface: any, productName: string): any | null {
    if (!surface) return null;
    const upload = surface.upload || {};
    const altText = `${productName} ${surface.name || 'customizer'} preview`;
    if (upload.imageDataBase64) {
      return {
        ...upload,
        altText,
        makePrimary: true
      };
    }
    const url = surface.baseImageUrl || surface.imageUrl || surface.url || '';
    return url
      ? { url, altText, makePrimary: true }
      : null;
  }

  protected customizationAutosaveLabel(): string {
    if (!this.customizationBuilder.productId) {
      return 'Saves with listing';
    }
    return this.customizationAutosaveStatus() || 'Autosave ready';
  }

  protected scheduleCustomizationAutosave(delayMs = 900): void {
    if (!this.customizationBuilder.productId) {
      return;
    }
    if (this.customizationAutosaveTimer) {
      clearTimeout(this.customizationAutosaveTimer);
    }
    this.customizationAutosaveStatus.set('Autosave pending...');
    this.customizationAutosaveTimer = setTimeout(() => {
      this.customizationAutosaveTimer = null;
      void this.autosaveCustomizationTemplate();
    }, delayMs);
  }

  private clearCustomizationAutosave(): void {
    if (this.customizationAutosaveTimer) {
      clearTimeout(this.customizationAutosaveTimer);
      this.customizationAutosaveTimer = null;
    }
  }

  private async autosaveCustomizationTemplate(): Promise<void> {
    const productId = this.customizationBuilder.productId;
    if (!productId) return;
    if (!this.customizationReadyForSave(false)) {
      this.customizationAutosaveStatus.set('Autosave waiting for required setup.');
      return;
    }
    this.customizationAutosaveStatus.set('Autosaving...');
    const template = await this.saveCustomizationTemplate(productId, false, true);
    if (template?.id) {
      this.customizationAutosaveStatus.set(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    }
  }

  private async saveCustomizationTemplate(productId: string, reloadOperations: boolean, silent = false): Promise<any | null> {
    const payload = this.customizationPayload(productId);
    const template = silent
      ? await this.postSilent(`/api/products/${productId}/customization-template`, payload, false)
      : await this.post(`/api/products/${productId}/customization-template`, payload, 'Product customizer saved.', false);
    if (template && reloadOperations) {
      await this.loadOperations();
      const product = this.vendorProducts().find((item) => item.id === productId) || {
        id: productId,
        name: template.productName || this.customizationBuilder.productName
      };
      this.customizationBuilder = this.customizationBuilderFromTemplate(product, template);
    } else if (template) {
      this.mergeSavedCustomizationSurfaceImages(template);
    }
    return template;
  }

  private mergeSavedCustomizationSurfaceImages(template: any): void {
    const savedSurfaces = new Map<string, any>((template?.surfaces ?? []).map((surface: any) => [surface.id, surface]));
    const savedSurfacesByKey = new Map<string, any>((template?.surfaces ?? []).map((surface: any) => [surface.surfaceKey, surface]));
    for (const surface of this.customizationBuilder.surfaces) {
      const saved = savedSurfaces.get(surface.id) || savedSurfacesByKey.get(surface.surfaceKey);
      if (saved?.id && saved.id !== surface.id) {
        const previousId = surface.id;
        surface.id = saved.id;
        if (this.customizationBuilder.selectedSurfaceId === previousId) {
          this.customizationBuilder.selectedSurfaceId = saved.id;
          this.customizationBuilder.surface = surface;
        }
        for (const field of this.customizationBuilder.fields) {
          if (field.placementsBySurface?.[previousId]) {
            field.placementsBySurface[saved.id] = field.placementsBySurface[previousId];
            delete field.placementsBySurface[previousId];
          }
        }
      }
      if (saved?.baseImageUrl) {
        surface.baseImageUrl = saved.baseImageUrl;
        surface.upload = this.emptyImageForm();
      }
    }
    this.syncSelectedFieldPlacement();
  }

  private customizationReadyForSave(showMessage = true): boolean {
    const missingSurface = this.customizationBuilder.surfaces.find((surface) => !this.customizationSurfacePreviewUrl(surface));
    if (missingSurface) {
      if (showMessage) this.message.set(`Choose a blank/base image for ${missingSurface.name} before saving this customizable product.`);
      return false;
    }
    if (!this.customizationBuilder.fields.length) {
      if (showMessage) this.message.set('Add at least one customer input field before saving a customizable product.');
      return false;
    }
    for (const field of this.customizationBuilder.fields) {
      if (!field.label.trim()) {
        if (showMessage) this.message.set('Every customization field needs a label.');
        return false;
      }
      if (field.fieldType === 'select' && !this.optionLabelsFromText(field.optionsText).length) {
        if (showMessage) this.message.set(`${field.label} needs at least one dropdown option.`);
        return false;
      }
      for (const placement of Object.values(field.placementsBySurface || {})) {
        placement.xPercent = this.clamp(placement.xPercent, 0, 100);
        placement.yPercent = this.clamp(placement.yPercent, 0, 100);
        placement.widthPercent = this.clamp(placement.widthPercent, 8, 100);
        placement.heightPercent = this.clamp(placement.heightPercent, 4, 60);
      }
    }
    return true;
  }

  private customizationPayload(productId: string): any {
    const builder = this.customizationBuilder;
    return {
      productType: builder.productType || 'other',
      title: builder.title || `Customize ${builder.productName || this.listingPreviewName()}`,
      instructions: builder.instructions || 'Enter your customization details before adding this item to cart.',
      previewMode: 'live_preview',
      status: builder.status || 'active',
      surfaces: builder.surfaces.map((surface, index) => ({
        id: surface.id,
        name: surface.name || this.customizationPresetLabel(builder.productType),
        surfaceKey: surface.surfaceKey || `surface_${index + 1}`,
        baseImageUrl: surface.baseImageUrl || '',
        widthPx: surface.widthPx || 900,
        heightPx: surface.heightPx || 900,
        sortOrder: index,
        ...(surface.upload.imageDataBase64 ? {
          imageName: surface.upload.imageName,
          imageMimeType: surface.upload.imageMimeType,
          imageSizeBytes: surface.upload.imageSizeBytes,
          imageDataBase64: surface.upload.imageDataBase64
        } : {})
      })),
      fields: builder.fields.map((field, index) => ({
        id: field.id,
        fieldKey: field.fieldKey || this.customizationKey(field.label),
        label: field.label.trim(),
        fieldType: field.fieldType,
        placeholder: field.placeholder || null,
        helpText: field.helpText || null,
        isRequired: field.isRequired,
        defaultValue: this.defaultCustomizationValue(field),
        minLength: field.minLength,
        maxLength: field.maxLength,
        minValue: field.minValue,
        maxValue: field.maxValue,
        priceDeltaJmd: field.priceDeltaJmd || 0,
        status: 'active',
        sortOrder: index,
        options: field.fieldType === 'select'
          ? this.optionRecordsFromText(field.optionsText).map((option, optionIndex) => ({
              id: this.newDraftId(),
              optionValue: this.customizationKey(option.label),
              label: option.label,
              priceDeltaJmd: option.priceDeltaJmd,
              sortOrder: optionIndex,
              status: 'active'
            }))
          : [],
        placements: Object.entries(field.placementsBySurface || {}).map(([surfaceId, placement]) => ({
          id: placement.id,
          surfaceId,
          xPercent: placement.xPercent,
          yPercent: placement.yPercent,
          widthPercent: placement.widthPercent,
          heightPercent: placement.heightPercent,
          rotationDegrees: placement.rotationDegrees,
          fontFamily: placement.fontFamily || null,
          fontSizePercent: placement.fontSizePercent,
          fontWeight: placement.fontWeight,
          textAlign: placement.textAlign,
          textColor: placement.textColor,
          backgroundColor: placement.backgroundColor || null,
          zIndex: placement.zIndex
        }))
      })),
      productId
    };
  }

  private builderWithPreset(productType: string, productName: string): CustomizationBuilderState {
    const preset = this.customizationPresetConfig(productType);
    const surfaces = preset.surfaces.map((surface: CustomizationPresetSurface, index: number) => ({
      id: this.newDraftId(),
      name: surface.name,
      surfaceKey: surface.surfaceKey,
      baseImageUrl: '',
      widthPx: surface.widthPx,
      heightPx: surface.heightPx,
      sortOrder: index,
      upload: this.emptyImageForm()
    }));
    const fields = preset.fields.map((field: CustomizationPresetField, index: number) => this.fieldDraftFromPreset(field, index, surfaces));
    return {
      productId: '',
      productName,
      productType: preset.value,
      title: productName ? `Customize ${productName}` : 'Customize this item',
      instructions: preset.instructions,
      status: 'active',
      surface: surfaces[0],
      surfaces,
      selectedSurfaceId: surfaces[0].id,
      fields,
      selectedFieldId: fields[0]?.localId || ''
    };
  }

  private fieldDraftFromPreset(field: CustomizationPresetField, index: number, surfaces: CustomizationSurfaceDraft[]): CustomizationFieldDraft {
    const id = this.newDraftId();
    const surface = surfaces.find((item) => item.surfaceKey === field.surfaceKey) || surfaces[0];
    const placement = this.placementFromRecord(field.placement || null, index);
    const placementsBySurface = surface ? { [surface.id]: placement } : {};
    return {
      id,
      localId: id,
      fieldKey: this.customizationKey(field.label),
      label: field.label,
      fieldType: field.fieldType,
      placeholder: field.placeholder || '',
      defaultValue: field.defaultValue || '',
      helpText: field.helpText || '',
      isRequired: field.isRequired ?? true,
      minLength: null,
      maxLength: field.maxLength ?? 40,
      minValue: null,
      maxValue: null,
      priceDeltaJmd: field.priceDeltaJmd ?? null,
      optionsText: field.optionsText || '',
      placement,
      placementsBySurface
    };
  }

  private customizationPresetConfig(value: string): CustomizationPresetConfig {
    const presets: Record<string, CustomizationPresetConfig> = {
      t_shirt: {
        value: 't_shirt',
        label: 'T-shirt',
        instructions: 'Enter the shirt details and review the front and back previews before adding to cart.',
        surfaces: [
          { name: 'Front', surfaceKey: 'front', widthPx: 1200, heightPx: 1400 },
          { name: 'Back', surfaceKey: 'back', widthPx: 1200, heightPx: 1400 }
        ],
        fields: [
          { label: 'Front text', fieldType: 'text', placeholder: 'Front message', defaultValue: 'Urban', surfaceKey: 'front', placement: { xPercent: 50, yPercent: 42, widthPercent: 48, heightPercent: 12 } },
          { label: 'Front logo/artwork', fieldType: 'image', placeholder: 'Upload logo or artwork', isRequired: false, priceDeltaJmd: 1000, surfaceKey: 'front', placement: { xPercent: 50, yPercent: 58, widthPercent: 32, heightPercent: 22 } },
          { label: 'Back name', fieldType: 'text', placeholder: 'Name on back', defaultValue: 'Name', surfaceKey: 'back', placement: { xPercent: 50, yPercent: 32, widthPercent: 52, heightPercent: 10 } },
          { label: 'Back number', fieldType: 'number', placeholder: '00', defaultValue: '00', surfaceKey: 'back', placement: { xPercent: 50, yPercent: 47, widthPercent: 36, heightPercent: 18, fontSizePercent: 20 } }
        ]
      },
      cup: {
        value: 'cup',
        label: 'Cup',
        instructions: 'Add the cup wrap details. The wrap surface is best for names, short messages, and logo placement.',
        surfaces: [{ name: 'Wrap area', surfaceKey: 'wrap', widthPx: 1600, heightPx: 600 }],
        fields: [
          { label: 'Cup name', fieldType: 'text', placeholder: 'Name', defaultValue: 'Name', surfaceKey: 'wrap', placement: { xPercent: 35, yPercent: 48, widthPercent: 28, heightPercent: 18 } },
          { label: 'Message', fieldType: 'text', placeholder: 'Short message', defaultValue: 'Best day', surfaceKey: 'wrap', placement: { xPercent: 66, yPercent: 48, widthPercent: 34, heightPercent: 18 } },
          { label: 'Photo or logo', fieldType: 'image', placeholder: 'Upload photo or logo', isRequired: false, priceDeltaJmd: 1000, surfaceKey: 'wrap', placement: { xPercent: 50, yPercent: 70, widthPercent: 24, heightPercent: 22 } }
        ]
      },
      bottle: {
        value: 'bottle',
        label: 'Water bottle',
        instructions: 'Set up the bottle label area for a name, short phrase, or simple brand mark.',
        surfaces: [{ name: 'Front label', surfaceKey: 'front_label', widthPx: 900, heightPx: 1200 }],
        fields: [
          { label: 'Bottle name', fieldType: 'text', placeholder: 'Name', defaultValue: 'Name', surfaceKey: 'front_label', placement: { xPercent: 50, yPercent: 38, widthPercent: 48, heightPercent: 12 } },
          { label: 'Accent color', fieldType: 'color', defaultValue: '#ff7a00', surfaceKey: 'front_label', placement: { xPercent: 50, yPercent: 54, widthPercent: 34, heightPercent: 10 } }
        ]
      },
      keychain: {
        value: 'keychain',
        label: 'Keychain',
        instructions: 'Use the face surface for initials, a short name, or a small message.',
        surfaces: [{ name: 'Face', surfaceKey: 'face', widthPx: 800, heightPx: 800 }],
        fields: [
          { label: 'Initials', fieldType: 'text', placeholder: 'A.B.', defaultValue: 'JA', surfaceKey: 'face', placement: { xPercent: 50, yPercent: 40, widthPercent: 42, heightPercent: 16, fontSizePercent: 18 } },
          { label: 'Small image', fieldType: 'image', placeholder: 'Upload small image', isRequired: false, priceDeltaJmd: 700, surfaceKey: 'face', placement: { xPercent: 50, yPercent: 60, widthPercent: 36, heightPercent: 28 } }
        ]
      },
      necklace: {
        value: 'necklace',
        label: 'Necklace',
        instructions: 'Use the pendant face for initials, birth month, or a short inscription.',
        surfaces: [{ name: 'Pendant face', surfaceKey: 'pendant_face', widthPx: 800, heightPx: 800 }],
        fields: [
          { label: 'Pendant initials', fieldType: 'text', placeholder: 'Initials', defaultValue: 'UM', surfaceKey: 'pendant_face', placement: { xPercent: 50, yPercent: 50, widthPercent: 34, heightPercent: 18, fontSizePercent: 17 } },
          { label: 'Finish', fieldType: 'select', optionsText: 'Gold, Silver, Rose gold +500', defaultValue: 'Gold', surfaceKey: 'pendant_face', placement: { xPercent: 50, yPercent: 72, widthPercent: 46, heightPercent: 10 } }
        ]
      },
      sticker: {
        value: 'sticker',
        label: 'Sticker',
        instructions: 'Set up a sticker or decal with text, color, and size options.',
        surfaces: [{ name: 'Decal face', surfaceKey: 'decal_face', widthPx: 1200, heightPx: 1200 }],
        fields: [
          { label: 'Sticker text', fieldType: 'text', placeholder: 'Your text', defaultValue: 'Local', surfaceKey: 'decal_face', placement: { xPercent: 50, yPercent: 48, widthPercent: 60, heightPercent: 16 } },
          { label: 'Artwork', fieldType: 'image', placeholder: 'Upload artwork', isRequired: false, priceDeltaJmd: 500, surfaceKey: 'decal_face', placement: { xPercent: 50, yPercent: 32, widthPercent: 42, heightPercent: 24 } },
          { label: 'Size', fieldType: 'select', optionsText: 'Small, Medium +300, Large +600', defaultValue: 'Small', surfaceKey: 'decal_face', placement: { xPercent: 50, yPercent: 70, widthPercent: 46, heightPercent: 10 } }
        ]
      },
      other: {
        value: 'other',
        label: 'Generic custom product',
        instructions: 'Add the custom details customers should provide and place them on the product image.',
        surfaces: [{ name: 'Front', surfaceKey: 'front', widthPx: 900, heightPx: 900 }],
        fields: [
          { label: 'Custom text', fieldType: 'text', placeholder: 'Your text', defaultValue: 'Your text', surfaceKey: 'front', placement: { xPercent: 50, yPercent: 50, widthPercent: 52, heightPercent: 14 } }
        ]
      }
    };
    return presets[value] || presets['other'];
  }

  private customizationBuilderFromTemplate(product: any, template: any | null): CustomizationBuilderState {
    if (!template) {
      const builder = this.builderWithPreset('t_shirt', product?.name || '');
      return {
        ...builder,
        productId: product?.id || '',
        productName: product?.name || '',
        title: `Customize ${product?.name || 'this item'}`
      };
    }
    const preset = this.customizationPresetConfig(template.productType || 't_shirt');
    const surfaces = (template.surfaces?.length ? template.surfaces : preset.surfaces).map((surface: any, index: number) => ({
      id: surface.id || this.newDraftId(),
      name: surface.name || preset.surfaces[index]?.name || `Surface ${index + 1}`,
      surfaceKey: surface.surfaceKey || preset.surfaces[index]?.surfaceKey || `surface_${index + 1}`,
      baseImageUrl: surface.baseImageUrl || (index === 0 ? product?.imageUrl || '' : ''),
      widthPx: Number(surface.widthPx || preset.surfaces[index]?.widthPx || 900),
      heightPx: Number(surface.heightPx || preset.surfaces[index]?.heightPx || 900),
      sortOrder: Number(surface.sortOrder ?? index),
      upload: this.emptyImageForm()
    }));
    const surfaceId = surfaces[0]?.id || this.newDraftId();
    const fields = (template?.fields ?? []).map((field: any, index: number) => {
      const fieldId = field.id || this.newDraftId();
      const placementsBySurface = (field.placements ?? []).reduce((records: Record<string, CustomizationPlacementDraft>, placement: any) => {
        records[placement.surfaceId] = this.placementFromRecord(placement, index);
        return records;
      }, {});
      const placement = placementsBySurface[surfaceId] || Object.values(placementsBySurface)[0] || this.defaultPlacement(index);
      return {
        id: fieldId,
        localId: fieldId,
        fieldKey: field.fieldKey || this.customizationKey(field.label || `field ${index + 1}`),
        label: field.label || `Field ${index + 1}`,
        fieldType: this.asCustomizationFieldType(field.fieldType),
        placeholder: field.placeholder || '',
        defaultValue: field.defaultValue || '',
        helpText: field.helpText || '',
        isRequired: Boolean(field.isRequired),
        minLength: field.minLength === null || field.minLength === undefined ? null : Number(field.minLength),
        maxLength: field.maxLength === null || field.maxLength === undefined ? null : Number(field.maxLength),
        minValue: field.minValue === null || field.minValue === undefined ? null : Number(field.minValue),
        maxValue: field.maxValue === null || field.maxValue === undefined ? null : Number(field.maxValue),
        priceDeltaJmd: field.priceDeltaJmd === null || field.priceDeltaJmd === undefined ? null : Number(field.priceDeltaJmd),
        optionsText: (field.options ?? []).map((option: any) => {
          const label = option.label || option.optionValue;
          const amount = Number(option.priceDeltaJmd || 0);
          return amount > 0 ? `${label} +${amount}` : label;
        }).filter(Boolean).join(', '),
        placement,
        placementsBySurface
      } satisfies CustomizationFieldDraft;
    });
    return {
      productId: product?.id || '',
      productName: product?.name || template?.productName || '',
      productType: template?.productType || 't_shirt',
      title: template?.title || `Customize ${product?.name || 'this item'}`,
      instructions: template?.instructions || 'Enter your customization details before adding this item to cart.',
      status: template?.status || 'active',
      surface: surfaces[0],
      surfaces,
      selectedSurfaceId: surfaceId,
      fields,
      selectedFieldId: fields[0]?.localId || ''
    };
  }

  private emptyCustomizationBuilder(): CustomizationBuilderState {
    return this.builderWithPreset('t_shirt', '');
  }

  private emptyCustomizationFieldForm(): CustomizationFieldDraft {
    const id = this.newDraftId();
    return {
      id,
      localId: id,
      fieldKey: '',
      label: '',
      fieldType: 'text',
      placeholder: '',
      defaultValue: '',
      helpText: '',
      isRequired: true,
      minLength: null,
      maxLength: 40,
      minValue: null,
      maxValue: null,
      priceDeltaJmd: null,
      optionsText: '',
      placement: this.defaultPlacement(0),
      placementsBySurface: {}
    };
  }

  private defaultPlacement(index: number): CustomizationPlacementDraft {
    return {
      id: this.newDraftId(),
      xPercent: 50,
      yPercent: Math.min(78, 42 + index * 10),
      widthPercent: 38,
      heightPercent: 9,
      rotationDegrees: 0,
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSizePercent: 14,
      fontWeight: '700',
      textAlign: 'center',
      textColor: '#132f3a',
      backgroundColor: '',
      zIndex: index + 1
    };
  }

  private placementFromRecord(record: any, index: number): CustomizationPlacementDraft {
    const fallback = this.defaultPlacement(index);
    return {
      id: record?.id || fallback.id,
      xPercent: Number(record?.xPercent ?? fallback.xPercent),
      yPercent: Number(record?.yPercent ?? fallback.yPercent),
      widthPercent: Number(record?.widthPercent ?? fallback.widthPercent),
      heightPercent: Number(record?.heightPercent ?? fallback.heightPercent),
      rotationDegrees: Number(record?.rotationDegrees ?? fallback.rotationDegrees),
      fontFamily: record?.fontFamily || fallback.fontFamily,
      fontSizePercent: Number(record?.fontSizePercent ?? fallback.fontSizePercent),
      fontWeight: record?.fontWeight || fallback.fontWeight,
      textAlign: record?.textAlign || fallback.textAlign,
      textColor: record?.textColor || fallback.textColor,
      backgroundColor: record?.backgroundColor || '',
      zIndex: Number(record?.zIndex ?? fallback.zIndex)
    };
  }

  private defaultCustomizationValue(field: Pick<CustomizationFieldDraft, 'fieldType' | 'defaultValue' | 'optionsText'>): string {
    if (field.fieldType === 'image') return '';
    if (field.defaultValue) return field.defaultValue;
    if (field.fieldType === 'number') return '00';
    if (field.fieldType === 'color') return '#ff7a00';
    if (field.fieldType === 'checkbox') return 'true';
    if (field.fieldType === 'select') return this.optionLabelsFromText(field.optionsText)[0] || '';
    return 'Your text';
  }

  private fontFamilyValue(value: string): string {
    const text = String(value || '').trim().replace(/[;"<>]/g, '').slice(0, 120);
    if (!text) return '';
    const option = this.customizationFontOptions.find((font) =>
      font.label.toLowerCase() === text.toLowerCase()
      || font.value.toLowerCase() === text.toLowerCase()
      || font.webFont?.toLowerCase() === text.toLowerCase()
    );
    if (option) return option.value;
    const primary = text.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    return primary ? `${primary}, Arial, sans-serif` : '';
  }

  private primaryFontName(value: string): string {
    return String(value || '')
      .split(',')[0]
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  private loadRecentCustomizationFonts(): string[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = JSON.parse(localStorage.getItem(this.customFontStorageKey) || '[]');
      return Array.isArray(raw) ? raw.map((font) => this.fontFamilyValue(String(font))).filter(Boolean).slice(0, 8) : [];
    } catch {
      return [];
    }
  }

  private rememberCustomizationFont(value: string): void {
    const fontFamily = this.fontFamilyValue(value);
    if (!fontFamily) return;
    const next = [fontFamily, ...this.recentCustomizationFonts.filter((font) => font !== fontFamily)].slice(0, 8);
    this.recentCustomizationFonts = next;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.customFontStorageKey, JSON.stringify(next));
    } catch {
      // Recent fonts are only a browser convenience.
    }
  }

  private ensureWebFont(value: string): void {
    if (typeof document === 'undefined') return;
    const primary = this.primaryFontName(value);
    if (!primary || this.loadedWebFonts.has(primary)) return;
    const webSafeFonts = new Set(['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Times', 'Courier New', 'Courier', 'Impact', 'Haettenschweiler', 'Trebuchet MS', 'Verdana', 'Tahoma', 'serif', 'sans-serif', 'monospace', 'cursive']);
    if (webSafeFonts.has(primary)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(primary).replace(/%20/g, '+')}:wght@400;600;700;800&display=swap`;
    document.head.appendChild(link);
    this.loadedWebFonts.add(primary);
  }

  private optionLabelsFromText(value: string): string[] {
    return this.optionRecordsFromText(value).map((option) => option.label);
  }

  private optionRecordsFromText(value: string): Array<{ label: string; priceDeltaJmd: number }> {
    return String(value || '')
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const match = item.match(/^(.*?)(?:\s*(?:\+|=|\|)\s*(?:JMD\s*)?(\d+(?:\.\d+)?))?$/i);
        const label = (match?.[1] || item).trim();
        const amount = Number(match?.[2] || 0);
        return {
          label,
          priceDeltaJmd: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0
        };
      })
      .filter((item) => Boolean(item.label));
  }

  private asCustomizationFieldType(value: string): CustomizationFieldType {
    return ['text', 'number', 'color', 'select', 'checkbox', 'image'].includes(String(value || '').toLowerCase())
      ? String(value).toLowerCase() as CustomizationFieldType
      : 'text';
  }

  private customizationPresetLabel(value: string): string {
    return this.customizationPresetOptions.find((item) => item.value === value)?.label || 'Custom item';
  }

  private customizationKey(value: string): string {
    return String(value || 'field')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'field';
  }

  private newDraftId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const value = Math.random() * 16 | 0;
      const resolved = char === 'x' ? value : (value & 0x3 | 0x8);
      return resolved.toString(16);
    });
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? Number(value.toFixed(2)) : min));
  }

  private emptyImageForm(): ListingImageUpload {
    return {
      imageName: '',
      imageMimeType: '',
      imageSizeBytes: 0,
      imageDataBase64: ''
    };
  }

  private async readImageFile(event: Event, assign: (image: ListingImageUpload) => void): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    assign(this.emptyImageForm());
    if (!file) return;

    const allowedTypes = ['image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/webp'];
    const allowedExtensions = ['.heic', '.heif', '.jpeg', '.jpg', '.png', '.webp'];
    const lowerName = file.name.toLowerCase();
    if (!allowedTypes.includes(file.type) && !allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
      this.message.set('Upload a JPG, PNG, WEBP, HEIC, or HEIF image.');
      input.value = '';
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.message.set('Choose an image smaller than 20 MB.');
      input.value = '';
      return;
    }

    try {
      const image = await this.readOptimizedImageFile(file, 1800);
      if (Number(image.imageSizeBytes || 0) > 8 * 1024 * 1024) {
        this.message.set('Image must be 8 MB or smaller after compression.');
        input.value = '';
        return;
      }
      assign(image);
    } catch {
      this.message.set('Image could not be read. Try selecting it again.');
      input.value = '';
    }
  }

  private resetFileInput(id: string): void {
    if (typeof document === 'undefined') return;
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input) input.value = '';
  }

  private async readOptimizedImageFile(file: File, maxDimension: number): Promise<ListingImageUpload> {
    const originalDataUrl = await this.fileToDataUrl(file);
    const original = {
      imageName: file.name,
      imageMimeType: file.type || this.mimeTypeFromFileName(file.name),
      imageSizeBytes: file.size,
      imageDataBase64: this.base64FromDataUrl(originalDataUrl)
    };
    const compressed = await this.compressImageDataUrl(originalDataUrl, original.imageMimeType, maxDimension);
    return compressed && Number(compressed.imageSizeBytes || 0) < file.size
      ? { ...compressed, imageName: file.name }
      : original;
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Image could not be read'));
      reader.readAsDataURL(file);
    });
  }

  private compressImageDataUrl(dataUrl: string, mimeType: string, maxDimension: number): Promise<ListingImageUpload | null> {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
    if (mimeType === 'image/heic' || mimeType === 'image/heif') return Promise.resolve(null);

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const compressedDataUrl = String(reader.result || '');
            resolve({
              imageName: '',
              imageMimeType: blob.type || 'image/webp',
              imageSizeBytes: blob.size,
              imageDataBase64: this.base64FromDataUrl(compressedDataUrl)
            });
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        }, 'image/webp', 0.86);
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  private base64FromDataUrl(value: string): string {
    return value.includes(',') ? value.split(',')[1] : value;
  }

  private mimeTypeFromFileName(name: string): string {
    const extension = name.toLowerCase().split('.').pop();
    return {
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      heic: 'image/heic',
      heif: 'image/heif',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      pdf: 'application/pdf',
      png: 'image/png',
      webp: 'image/webp'
    }[extension || ''] || 'application/octet-stream';
  }

  private async request(path: string, method: string, body: unknown, successMessage: string, reload = true): Promise<any | null> {
    try {
      const response = await fetch(apiUrl(path), {
        method,
        headers: this.auth.authHeaders(),
        body: body === null || body === undefined ? undefined : JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Request failed.');
      }
      this.message.set(successMessage);
      if (reload) {
        await this.loadOperations();
      }
      return payload;
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Request failed.');
      return null;
    }
  }

  private async post(path: string, body: unknown, successMessage: string, reload = true): Promise<any | null> {
    return this.request(path, 'POST', body, successMessage, reload);
  }

  private async postSilent(path: string, body: unknown, reload = true): Promise<any | null> {
    try {
      const response = await fetch(apiUrl(path), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: body === null || body === undefined ? undefined : JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Request failed.');
      }
      if (reload) {
        await this.loadOperations();
      }
      return payload;
    } catch (error) {
      this.customizationAutosaveStatus.set(error instanceof Error ? `Autosave failed: ${error.message}` : 'Autosave failed.');
      return null;
    }
  }
}
