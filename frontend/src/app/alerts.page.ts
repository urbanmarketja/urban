import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';

interface AlertItem {
  id: string;
  audience: string;
  severity: 'critical' | 'warning' | 'notice' | 'ok' | string;
  type: string;
  title: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
  orderId?: string;
  bookingId?: string;
  canConfirmReceipt?: boolean;
  canConfirmServiceCompletion?: boolean;
  createdAt?: string;
  readAt?: string | null;
}

@Component({
  selector: 'app-alerts-page',
  imports: [RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Alerts</p>
          <h1>Important account updates</h1>
          <p>Orders, deliveries, subscriptions, and account actions that need attention.</p>
        </div>
      </section>

      <section class="container section">
        @if (message()) {
          <div class="notice error">{{ message() }}</div>
        }

        <div class="admin-toolbar">
          <div class="section-heading">
            <h2>{{ pageTitle() }}</h2>
            <p>{{ pageDescription() }}</p>
          </div>
          <button class="button-sm" type="button" (click)="loadAlerts()">Refresh</button>
        </div>

        <div class="dashboard-grid">
          @for (alert of alerts(); track alert.id) {
            <article class="dashboard-card alert-card" [class.alert-critical]="alert.severity === 'critical'" [class.alert-warning]="alert.severity === 'warning'">
              <span class="product-tag">{{ alertLabel(alert) }}</span>
              <h3>{{ alert.title }}</h3>
              <p>{{ alert.message }}</p>
              <p class="product-meta">{{ alert.createdAt || 'Recent' }}</p>
              @if (alert.actionUrl) {
                <a class="button-sm" [routerLink]="alert.actionUrl">{{ alert.actionLabel || 'Open' }}</a>
              }
              @if (alert.canConfirmReceipt && alert.orderId) {
                <button class="button-sm" type="button" (click)="confirmReceived(alert.orderId)">Confirm received</button>
                <button class="button-sm danger" type="button" (click)="reportIssue(alert.orderId)">Report issue</button>
              }
              @if (alert.canConfirmServiceCompletion && alert.bookingId) {
                <button class="button-sm" type="button" (click)="confirmServiceCompleted(alert.bookingId)">Confirm completed</button>
                <button class="button-sm danger" type="button" (click)="reportServiceIssue(alert.bookingId)">Report issue</button>
              }
            </article>
          } @empty {
            <div class="cart-empty">No alerts right now.</div>
          }
        </div>
      </section>
    </main>
  `
})
export class AlertsPage implements OnInit {
  private readonly auth = inject(AuthService);
  protected readonly alerts = signal<AlertItem[]>([]);
  protected readonly message = signal('');

  ngOnInit(): void {
    void this.loadAlerts();
  }

  protected async loadAlerts(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/alerts'), { headers: this.auth.authHeaders() });
      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(payload.error || 'Alerts could not be loaded.');
      }
      this.alerts.set(payload as AlertItem[]);
      this.message.set('');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Alerts could not be loaded.');
    }
  }

  protected pageTitle(): string {
    const role = this.auth.currentUser()?.role;
    if (role === 'vendor') return 'Vendor alerts';
    if (role === 'customer') return 'Customer alerts';
    return 'Platform alerts';
  }

  protected pageDescription(): string {
    const role = this.auth.currentUser()?.role;
    if (role === 'vendor') return 'New orders, held credits, subscription reminders, and compliance notifications.';
    if (role === 'customer') return 'Delivered packages, receipt confirmations, service bookings, and order updates.';
    return 'Compliance and operational alerts across the marketplace.';
  }

  protected alertLabel(alert: AlertItem): string {
    if (alert.severity === 'critical') return 'Critical';
    if (alert.severity === 'warning') return 'Action needed';
    return alert.type.replace(/_/g, ' ');
  }

  protected async confirmReceived(orderId: string): Promise<void> {
    await this.post(`/api/orders/${orderId}/confirm-received`, {}, 'Receipt confirmed. Held vendor credits were released.');
  }

  protected async reportIssue(orderId: string): Promise<void> {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Report an issue with this order? Held vendor credits will stay locked while the site owner reviews it.');
      if (!confirmed) return;
    }
    await this.post(`/api/orders/${orderId}/dispute`, {
      reason: 'customer_reported_issue',
      notes: 'Customer reported an issue from alerts.'
    }, 'Order issue reported. Held credits will stay locked while it is reviewed.');
  }

  protected async confirmServiceCompleted(bookingId: string): Promise<void> {
    await this.post(`/api/bookings/${bookingId}/confirm-completed`, {}, 'Service completion confirmed. Held vendor credits were released.');
  }

  protected async reportServiceIssue(bookingId: string): Promise<void> {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Report an issue with this service? Held vendor credits will stay locked while the site owner reviews it.');
      if (!confirmed) return;
    }
    await this.post(`/api/bookings/${bookingId}/dispute`, {
      reason: 'customer_reported_issue',
      notes: 'Customer reported a service issue from alerts.'
    }, 'Service issue reported. Held credits will stay locked while it is reviewed.');
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
      await this.loadAlerts();
      this.message.set(successMessage);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Request failed.');
    }
  }
}
