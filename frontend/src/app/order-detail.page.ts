import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { formatCurrency } from './market-data';

interface OrderItem {
  id?: string;
  productId?: string | null;
  name: string;
  price: number;
  qty: number;
  lineTotal?: number;
  vendorId: string;
  vendorName: string;
  storeId?: string;
  storeName: string;
  storeSlug?: string;
  fulfillmentStatus?: string;
  vendorCompletedAt?: string | null;
  customerReceivedAt?: string | null;
  fundsReleasedAt?: string | null;
}

interface OrderDetail {
  orderId: string;
  invoiceNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod?: string;
  paymentSessionId?: string;
  paymentSessionStatus?: string;
  paymentProvider?: string;
  total: number;
  deliveryAddress?: string;
  createdAt: string;
  customerName?: string;
  customerContact?: string;
  canConfirmReceipt?: boolean;
  heldItemCount?: number;
  receiptConfirmedAt?: string | null;
  waitingReceiptSince?: string | null;
  daysWaitingForReceipt?: number;
  isReceiptLate?: boolean;
  hasOpenDispute?: boolean;
  disputeStatus?: string | null;
  paymentSession?: {
    id: string;
    provider?: string;
    status?: string;
    checkoutUrl?: string;
  } | null;
  items: OrderItem[];
}

@Component({
  selector: 'app-order-detail-page',
  imports: [RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Order details</p>
          <h1>{{ order()?.orderId || 'Loading order' }}</h1>
          <p>Payment, fulfillment, vendor store totals, and invoice status in one place.</p>
        </div>
      </section>

      <section class="container section">
        @if (message()) {
          <div class="notice">{{ message() }}</div>
        }
        @if (error()) {
          <div class="notice error">{{ error() }}</div>
        }

        @if (order(); as currentOrder) {
          <div class="dashboard-grid">
            <article class="dashboard-card">
              <h2>Payment</h2>
              <div class="stats-list">
                <div><strong>{{ paymentLabel(currentOrder) }}</strong><span>Status</span></div>
                <div><strong>{{ currentOrder.paymentMethod || 'Dime' }}</strong><span>Method</span></div>
                <div><strong>{{ currentOrder.paymentSession?.id || currentOrder.paymentSessionId || 'Not created' }}</strong><span>Session</span></div>
              </div>
              @if ((currentOrder.paymentStatus || currentOrder.paymentSessionStatus) !== 'paid') {
                <button class="button primary-button" type="button" (click)="confirmPayment(currentOrder)" [disabled]="isWorking()">
                  {{ isWorking() ? 'Confirming...' : 'Confirm payment' }}
                </button>
              }
            </article>

            <article class="dashboard-card">
              <h2>Fulfillment</h2>
              <div class="stats-list">
                <div><strong>{{ stageLabel(currentOrder) }}</strong><span>Order stage</span></div>
                <div><strong>{{ currentOrder.heldItemCount ?? 0 }}</strong><span>Items with held credits</span></div>
                <div><strong>{{ currentOrder.receiptConfirmedAt ? 'Confirmed' : 'Not confirmed' }}</strong><span>Receipt</span></div>
              </div>
              @if (currentOrder.canConfirmReceipt) {
                <button class="button primary-button" type="button" (click)="confirmReceived(currentOrder)" [disabled]="isWorking()">
                  Confirm received
                </button>
                <button class="button outline-button" type="button" (click)="reportIssue(currentOrder)" [disabled]="isWorking()">
                  Report issue
                </button>
              }
              @if (currentOrder.hasOpenDispute) {
                <div class="notice error">
                  <strong>Order issue open</strong>
                  <p>Held vendor credits stay locked until the issue is reviewed.</p>
                </div>
              }
            </article>

            <article class="dashboard-card">
              <h2>Invoice</h2>
              <p><strong>{{ currentOrder.invoiceNumber }}</strong></p>
              <p class="product-meta">{{ money(currentOrder.total) }} total across {{ storeSections(currentOrder).length }} store(s).</p>
              <button class="button secondary-button" type="button" (click)="downloadInvoice(currentOrder)" [disabled]="isWorking()">Download invoice</button>
            </article>
          </div>

          <section class="section">
            <div class="section-heading">
              <h2>Store totals</h2>
              <p>Each section shows which store is responsible for those items and the value assigned to that store.</p>
            </div>
            <div class="dashboard-grid">
              @for (store of storeSections(currentOrder); track store.name) {
                <article class="dashboard-card">
                  <h3>{{ store.name }}</h3>
                  <p><strong>{{ money(store.subtotal) }}</strong></p>
                  <div class="table-wrap">
                    <table class="admin-table">
                      <thead><tr><th>Item</th><th>Qty</th><th>Total</th><th>Fulfillment</th><th>Funds</th></tr></thead>
                      <tbody>
                        @for (item of store.items; track item.id || item.name) {
                          <tr>
                            <td>
                              @if (item.productId && item.storeSlug) {
                                <a class="product-name-link" [routerLink]="['/vendor', item.storeSlug, 'product', item.productId]">{{ item.name }}</a>
                              } @else {
                                {{ item.name }}
                              }
                            </td>
                            <td>{{ item.qty }}</td>
                            <td>{{ money(lineTotal(item)) }}</td>
                            <td><span class="status-pill" [class.warn]="item.fulfillmentStatus !== 'fulfilled'">{{ item.fulfillmentStatus || 'pending' }}</span></td>
                            <td><span class="status-pill" [class.warn]="!item.fundsReleasedAt">{{ item.fundsReleasedAt ? 'released' : 'held' }}</span></td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </article>
              }
            </div>
          </section>

          <div class="checkout-actions">
            <a class="button secondary-button" routerLink="/user-dashboard">Back to dashboard</a>
            <a class="button primary-button" routerLink="/marketplace">Shop more</a>
          </div>
        } @else {
          <div class="cart-empty">Loading order details...</div>
        }
      </section>
    </main>
  `
})
export class OrderDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  protected readonly money = formatCurrency;
  protected readonly order = signal<OrderDetail | null>(null);
  protected readonly message = signal('');
  protected readonly error = signal('');
  protected readonly isWorking = signal(false);

  ngOnInit(): void {
    void this.loadOrder();
  }

  protected async loadOrder(): Promise<void> {
    const orderId = this.route.snapshot.paramMap.get('id');
    if (!orderId) {
      this.error.set('Order ID is missing.');
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/orders/${encodeURIComponent(orderId)}`), {
        headers: this.auth.authHeaders()
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Order could not be loaded.');
      }
      this.order.set(payload as OrderDetail);
    } catch (loadError) {
      this.error.set(loadError instanceof Error ? loadError.message : 'Order could not be loaded.');
    }
  }

  protected async confirmPayment(order: OrderDetail): Promise<void> {
    const sessionId = order.paymentSession?.id || order.paymentSessionId;
    if (!sessionId) {
      this.error.set('This order does not have a payment session yet.');
      return;
    }
    await this.post(`/api/payments/sessions/${sessionId}/mock-pay`, 'Payment confirmed. Vendor credits are now held.');
  }

  protected async confirmReceived(order: OrderDetail): Promise<void> {
    await this.post(`/api/orders/${order.orderId}/confirm-received`, 'Receipt confirmed. Held vendor credits were released.');
  }

  protected async reportIssue(order: OrderDetail): Promise<void> {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Report an issue with this order? Held vendor credits will stay locked while the site owner reviews it.');
      if (!confirmed) return;
    }
    await this.post(`/api/orders/${order.orderId}/dispute`, 'Order issue reported. Held vendor credits will stay locked while it is reviewed.', {
      reason: 'customer_reported_issue',
      notes: 'Customer reported an issue from the order detail page.'
    });
  }

  protected async downloadInvoice(order: OrderDetail): Promise<void> {
    this.isWorking.set(true);
    this.message.set('');
    this.error.set('');
    try {
      const response = await fetch(apiUrl(`/api/orders/${encodeURIComponent(order.orderId)}/invoice`), {
        headers: this.auth.authHeaders()
      });
      if (!response.ok) throw new Error('Invoice could not be downloaded.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${order.invoiceNumber}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.message.set('Invoice downloaded.');
    } catch (downloadError) {
      this.error.set(downloadError instanceof Error ? downloadError.message : 'Invoice could not be downloaded.');
    } finally {
      this.isWorking.set(false);
    }
  }

  protected storeSections(order: OrderDetail): Array<{ name: string; subtotal: number; items: OrderItem[] }> {
    const grouped = new Map<string, { name: string; subtotal: number; items: OrderItem[] }>();
    for (const item of order.items || []) {
      const name = item.storeName || item.vendorName || 'Urban Market JA vendor';
      const group = grouped.get(name) ?? { name, subtotal: 0, items: [] };
      group.items.push(item);
      group.subtotal += this.lineTotal(item);
      grouped.set(name, group);
    }
    return [...grouped.values()];
  }

  protected lineTotal(item: OrderItem): number {
    return Number(item.lineTotal ?? Number(item.price || 0) * Number(item.qty || 1));
  }

  protected paymentLabel(order: OrderDetail): string {
    const status = order.paymentStatus || order.paymentSessionStatus || order.paymentSession?.status || 'pending';
    if (status === 'paid') return 'Paid';
    if (status === 'failed') return 'Payment failed';
    if (status === 'refunded') return 'Refunded';
    return 'Awaiting payment';
  }

  protected stageLabel(order: OrderDetail): string {
    if ((order.paymentStatus || order.paymentSessionStatus) !== 'paid') return 'Awaiting payment confirmation';
    if (order.hasOpenDispute) return 'Issue under review';
    if (order.receiptConfirmedAt || order.status === 'completed' || Number(order.heldItemCount || 0) === 0) return 'Received and completed';
    if (order.isReceiptLate) return `Receipt confirmation overdue (${order.daysWaitingForReceipt || 0} days)`;
    if (order.items?.some((item) => item.fulfillmentStatus === 'fulfilled')) return 'Fulfilled - waiting for receipt';
    return 'Paid - fulfillment pending';
  }

  private async post(path: string, successMessage: string, body: unknown = {}): Promise<void> {
    this.isWorking.set(true);
    this.message.set('');
    this.error.set('');
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
      await this.loadOrder();
    } catch (postError) {
      this.error.set(postError instanceof Error ? postError.message : 'Request failed.');
    } finally {
      this.isWorking.set(false);
    }
  }
}
