import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { JobService } from './job.service';
import { formatCurrency } from './market-data';

interface CustomerOrder {
  orderId: string;
  total: number;
  status: string;
  paymentStatus?: string;
  paymentSessionStatus?: string;
  paymentSessionId?: string;
  createdAt: string;
  canConfirmReceipt?: boolean;
  heldItemCount?: number;
  receiptConfirmedAt?: string | null;
  waitingReceiptSince?: string | null;
  daysWaitingForReceipt?: number;
  isReceiptLate?: boolean;
  hasOpenDispute?: boolean;
  disputeStatus?: string | null;
}

interface ReviewTarget {
  targetKey: string;
  targetType: 'product' | 'store' | 'service';
  targetId: string;
  label: string;
  vendorId: string;
  vendorName: string;
  storeId?: string;
  storeName?: string;
  productId?: string;
  serviceId?: string;
  receivedAt?: string | null;
  canReview: boolean;
  reviewId?: string | null;
}

interface CustomerBooking {
  id: string;
  serviceId: string;
  serviceName: string;
  vendorName?: string;
  date: string;
  time: string;
  location: string;
  status: string;
  paymentStatus?: string;
  paymentSessionStatus?: string;
  paymentSessionId?: string;
  total?: number;
  heldCredits?: number;
  releasedCredits?: number;
  fundStatus?: string;
  canConfirmCompletion?: boolean;
  hasOpenDispute?: boolean;
  disputeStatus?: string | null;
  customerConfirmedAt?: string | null;
}

interface CustomerDashboard {
  orders: CustomerOrder[];
  bookings: CustomerBooking[];
  applications: Array<{ id: string; jobTitle: string; employer: string; status: string }>;
  addresses: Array<{ id: string; label: string; recipientName: string; addressLine1: string; parish: string; isDefault: boolean; latitude?: number | string | null; longitude?: number | string | null }>;
  reviews: Array<{ id: string; reviewType: string; rating: number; comment: string; status: string; productName?: string; serviceName?: string; storeName?: string; vendorName?: string }>;
  reviewTargets: ReviewTarget[];
}

@Component({
  selector: 'app-user-dashboard-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Customer dashboard</p>
          <h1>Track product orders and service bookings</h1>
          <p>All shopping, booking, addresses, reviews, and job activity stays in one account.</p>
        </div>
      </section>

      <section class="container section">
        @if (!auth.isSignedIn()) {
          <div class="notice">
            <strong>Preview mode</strong>
            <p>Sign in to keep this dashboard attached to your account.</p>
            <a class="button primary-button" routerLink="/login">Sign in</a>
          </div>
        }
        <div class="dashboard-grid">
          <article class="dashboard-card">
            <h2>Product orders</h2>
            @for (order of dashboard()?.orders ?? []; track order.orderId) {
              <div class="stats-list">
                <div>
                  <strong>{{ order.orderId }}</strong>
                  <span>{{ money(order.total) }} - {{ order.status }} - payment {{ order.paymentSessionStatus || order.paymentStatus || 'pending' }}</span>
                  @if ((order.paymentSessionStatus || order.paymentStatus) !== 'paid') {
                    <span>Payment session {{ order.paymentSessionId || 'pending' }} must be confirmed before vendors receive held credits.</span>
                    @if (order.paymentSessionId) {
                      <button class="button-sm" type="button" (click)="confirmPayment(order)">Confirm payment</button>
                    }
                  }
                  <a class="button-sm" [routerLink]="['/orders', order.orderId]">View details</a>
                  @if (order.canConfirmReceipt) {
                    <button class="button-sm" type="button" (click)="confirmReceived(order.orderId)">Confirm received</button>
                    <button class="button-sm danger" type="button" (click)="reportOrderIssue(order.orderId)">Report issue</button>
                  } @else if ((order.heldItemCount ?? 0) > 0) {
                    <span>Vendor credits are held until delivery is confirmed.</span>
                    @if (order.hasOpenDispute) {
                      <span>Issue reported: {{ order.disputeStatus || 'open' }}</span>
                    }
                  } @else if (order.receiptConfirmedAt) {
                    <span>Receipt confirmed</span>
                  }
                </div>
              </div>
            } @empty {
              <p>No product orders yet.</p>
            }
          </article>
          <article class="dashboard-card">
            <h2>Service bookings</h2>
            @for (booking of dashboard()?.bookings ?? []; track booking.id) {
              <div class="stats-list">
                <div>
                  <strong>{{ booking.serviceName }}</strong>
                  <span>{{ booking.date }} at {{ booking.time }} - {{ booking.status }} - payment {{ booking.paymentSessionStatus || booking.paymentStatus || 'pending' }}</span>
                  <span>{{ money(booking.total || 0) }} with {{ booking.heldCredits || 0 }} held / {{ booking.releasedCredits || 0 }} released credits</span>
                  @if ((booking.paymentSessionStatus || booking.paymentStatus) !== 'paid') {
                    <span>Payment must be confirmed before the vendor can start.</span>
                    @if (booking.paymentSessionId) {
                      <button class="button-sm" type="button" (click)="confirmServicePayment(booking)">Confirm payment</button>
                    }
                  } @else if (booking.canConfirmCompletion) {
                    <button class="button-sm" type="button" (click)="confirmServiceCompleted(booking.id)">Confirm completed</button>
                    <button class="button-sm danger" type="button" (click)="reportServiceIssue(booking.id)">Report issue</button>
                  } @else if (booking.hasOpenDispute) {
                    <span>Issue reported: {{ booking.disputeStatus || 'open' }}</span>
                  } @else if (booking.customerConfirmedAt) {
                    <span>Completion confirmed</span>
                  } @else {
                    <span>Vendor credits stay held until completion is confirmed.</span>
                  }
                </div>
              </div>
            } @empty {
              <p>No service bookings yet.</p>
            }
          </article>
          <article class="dashboard-card">
            <h2>Job applications</h2>
            @for (application of applications(); track application.id) {
              <div class="stats-list">
                <div><strong>{{ application.jobTitle }}</strong><span>{{ application.employer }} - {{ application.status }}</span></div>
              </div>
            } @empty {
              <p>No job applications yet.</p>
            }
          </article>
          <article class="dashboard-card">
            <h2>Addresses</h2>
            @for (address of dashboard()?.addresses ?? []; track address.id) {
              <div class="stats-list">
                <div><strong>{{ address.label }}</strong><span>{{ address.addressLine1 }} - {{ address.parish }}</span></div>
              </div>
            } @empty {
              <p>No saved addresses yet.</p>
            }
          </article>
        </div>
      </section>

      <section class="container section split-grid">
        <form class="profile-form" (ngSubmit)="saveAddress()">
          <h2>Save address</h2>
          <label>Label <input name="label" [(ngModel)]="addressForm.label"></label>
          <label>Recipient <input name="recipient" [(ngModel)]="addressForm.recipientName"></label>
          <label>Phone <input name="phone" [(ngModel)]="addressForm.phone"></label>
          <label>Parish <input name="parish" [(ngModel)]="addressForm.parish"></label>
          <label>Address <textarea name="addressLine1" [(ngModel)]="addressForm.addressLine1" rows="4" required></textarea></label>
          <div class="form-grid compact-form">
            <label>Latitude <input name="latitude" type="number" step="any" [(ngModel)]="addressForm.latitude" placeholder="18.0125"></label>
            <label>Longitude <input name="longitude" type="number" step="any" [(ngModel)]="addressForm.longitude" placeholder="-76.7981"></label>
          </div>
          <button class="button outline-button" type="button" (click)="useCurrentLocationForAddress()">Use current location for map</button>
          <label><input name="isDefault" type="checkbox" [(ngModel)]="addressForm.isDefault"> Default address</label>
          <button class="button primary-button" type="submit">Save address</button>
        </form>

        <form class="profile-form" (ngSubmit)="submitReview()">
          <h2>Leave a review</h2>
          <label>
            Review item
            <select name="reviewTarget" [(ngModel)]="reviewForm.targetKey" required>
              <option value="">Choose received product, store, or service</option>
              @for (target of reviewTargets(); track target.targetKey) {
                <option [value]="target.targetKey" [disabled]="!target.canReview">{{ targetLabel(target) }}</option>
              }
            </select>
          </label>
          @if (selectedReviewTarget(); as target) {
            <div class="notice">
              <strong>{{ targetTypeLabel(target.targetType) }}</strong>
              <p>{{ target.label }} from {{ target.vendorName }}{{ target.storeName ? ' / ' + target.storeName : '' }}</p>
            </div>
          }
          <label>Rating <input name="rating" type="number" min="1" max="5" [(ngModel)]="reviewForm.rating"></label>
          <label>Comment <textarea name="comment" [(ngModel)]="reviewForm.comment" rows="4" placeholder="Share what went well or what could improve"></textarea></label>
          <button class="button primary-button" type="submit" [disabled]="!selectedReviewTarget()">Submit review</button>
        </form>
      </section>

      <section class="container section">
        <div class="section-heading">
          <h2>Received items and review status</h2>
          <p>Products, stores, and services appear here after they are received or booked.</p>
        </div>
        <div class="dashboard-grid">
          @for (target of reviewTargets(); track target.targetKey) {
            <article class="dashboard-card">
              <span class="product-tag">{{ targetTypeLabel(target.targetType) }}</span>
              <h3>{{ target.label }}</h3>
              <p class="product-meta">{{ target.vendorName }}{{ target.storeName ? ' - ' + target.storeName : '' }}</p>
              @if (target.canReview) {
                <button class="button-sm" type="button" (click)="selectReviewTarget(target)">Review</button>
              } @else {
                <span class="status-pill">Reviewed</span>
              }
            </article>
          } @empty {
            <div class="cart-empty">No received products, stores, or services are ready for review yet.</div>
          }
        </div>
      </section>

      <section class="container section">
        <div class="section-heading">
          <h2>Your reviews</h2>
          <p>Store reviews, product reviews, and service reviews stay separate.</p>
        </div>
        <div class="dashboard-grid">
          @for (review of dashboard()?.reviews ?? []; track review.id) {
            <article class="dashboard-card">
              <span class="product-tag">{{ targetTypeLabel(review.reviewType) }}</span>
              <h3>{{ review.productName || review.serviceName || review.storeName || review.vendorName }}</h3>
              <p><strong>{{ review.rating }} star</strong></p>
              <p>{{ review.comment }}</p>
            </article>
          } @empty {
            <p>No reviews submitted yet.</p>
          }
        </div>
      </section>

      @if (message()) {
        <div class="container"><div class="notice">{{ message() }}</div></div>
      }
    </main>
  `
})
export class UserDashboardPage implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly jobService = inject(JobService);
  protected readonly money = formatCurrency;
  protected readonly dashboard = signal<CustomerDashboard | null>(null);
  protected readonly message = signal('');

  protected addressForm = { label: 'Home', recipientName: '', phone: '', parish: '', addressLine1: '', latitude: null as number | null, longitude: null as number | null, isDefault: true };
  protected reviewForm = { targetKey: '', rating: 5, comment: '' };

  ngOnInit(): void {
    void this.loadDashboard();
  }

  protected applications(): Array<{ id: string; jobTitle: string; employer: string; status: string }> {
    return this.dashboard()?.applications ?? this.jobService.applications();
  }

  protected reviewTargets(): ReviewTarget[] {
    return this.dashboard()?.reviewTargets ?? [];
  }

  protected selectedReviewTarget(): ReviewTarget | undefined {
    return this.reviewTargets().find((target) => target.targetKey === this.reviewForm.targetKey);
  }

  protected selectReviewTarget(target: ReviewTarget): void {
    if (!target.canReview) return;
    this.reviewForm.targetKey = target.targetKey;
  }

  protected targetLabel(target: ReviewTarget): string {
    return `${this.targetTypeLabel(target.targetType)} - ${target.label}${target.canReview ? '' : ' (reviewed)'}`;
  }

  protected targetTypeLabel(type: string): string {
    return type === 'product' ? 'Product' : type === 'service' ? 'Service' : 'Store';
  }

  protected async loadDashboard(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/dashboard/customer'), { headers: this.auth.authHeaders() });
      if (response.ok) {
        const payload = await response.json() as CustomerDashboard;
        this.dashboard.set(payload);
        if (!this.reviewForm.targetKey) {
          this.reviewForm.targetKey = payload.reviewTargets?.find((target) => target.canReview)?.targetKey || '';
        }
      }
    } catch {
      this.message.set('Customer dashboard API is unavailable.');
    }
  }

  protected async saveAddress(): Promise<void> {
    await this.post('/api/customer/addresses', this.addressForm, 'Address saved.');
  }

  protected useCurrentLocationForAddress(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.message.set('Location is not available in this browser.');
      return;
    }
    this.message.set('Checking this device location...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.addressForm.latitude = Number(position.coords.latitude.toFixed(6));
        this.addressForm.longitude = Number(position.coords.longitude.toFixed(6));
        this.message.set('Address map coordinates filled. Review them before saving.');
      },
      () => this.message.set('Location permission was not granted. You can enter latitude and longitude manually.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }

  protected async submitReview(): Promise<void> {
    const target = this.selectedReviewTarget();
    if (!target) {
      this.message.set('Choose a received product, store, or service to review.');
      return;
    }
    await this.post('/api/reviews', {
      reviewType: target.targetType,
      vendorId: target.vendorId,
      storeId: target.storeId,
      productId: target.targetType === 'product' ? target.productId : undefined,
      serviceId: target.targetType === 'service' ? target.serviceId : undefined,
      rating: this.reviewForm.rating,
      comment: this.reviewForm.comment
    }, 'Review submitted.');
    this.reviewForm = { targetKey: '', rating: 5, comment: '' };
  }

  protected async confirmReceived(orderId: string): Promise<void> {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Confirm that you received the goods or services for the fulfilled items in this order? This releases held vendor credits.');
      if (!confirmed) return;
    }
    await this.post(`/api/orders/${orderId}/confirm-received`, {}, 'Receipt confirmed. Held vendor credits were released.');
  }

  protected async confirmPayment(order: CustomerOrder): Promise<void> {
    if (!order.paymentSessionId) return;
    await this.post(`/api/payments/sessions/${order.paymentSessionId}/mock-pay`, {}, 'Payment confirmed. Vendor credits are now held until receipt confirmation.');
  }

  protected async confirmServicePayment(booking: CustomerBooking): Promise<void> {
    if (!booking.paymentSessionId) return;
    await this.post(`/api/payments/sessions/${booking.paymentSessionId}/mock-pay`, {}, 'Service payment confirmed. Vendor credits are now held until completion confirmation.');
  }

  protected async confirmServiceCompleted(bookingId: string): Promise<void> {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Confirm this service was completed? This releases held vendor credits.');
      if (!confirmed) return;
    }
    await this.post(`/api/bookings/${bookingId}/confirm-completed`, {}, 'Service completion confirmed. Held vendor credits were released.');
  }

  protected async reportServiceIssue(bookingId: string): Promise<void> {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Report an issue with this service? Held vendor credits will stay locked while the site owner reviews it.');
      if (!confirmed) return;
    }
    await this.post(`/api/bookings/${bookingId}/dispute`, {
      reason: 'customer_reported_issue',
      notes: 'Customer reported a service issue from their dashboard.'
    }, 'Service issue reported. Held credits will stay locked while it is reviewed.');
  }

  protected async reportOrderIssue(orderId: string): Promise<void> {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Report an issue with this order? Held vendor credits will stay locked while the site owner reviews it.');
      if (!confirmed) return;
    }
    await this.post(`/api/orders/${orderId}/dispute`, {
      reason: 'customer_reported_issue',
      notes: 'Customer reported an issue from their dashboard.'
    }, 'Order issue reported. Held credits will stay locked while it is reviewed.');
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
      await this.loadDashboard();
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Request failed.');
    }
  }
}
