import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';
import { DiscountSummary, discountLabelFor, formatCurrency, hasDiscountPrice } from './market-data';

interface OrderResponse {
  orderId: string;
  invoiceNumber: string;
  status: string;
  paymentStatus?: string;
  paymentSessionStatus?: string;
  total: number;
  createdAt: string;
  customer?: DeliveryDetails;
  paymentMethod?: string;
  paymentSession?: PaymentSessionSummary | null;
  paymentSessionId?: string;
  items?: InvoiceItem[];
}

interface PaymentSessionSummary {
  id: string;
  provider?: string;
  orderId?: string;
  kind?: string;
  amount?: number;
  status: string;
  checkoutUrl?: string;
}

interface DeliveryDetails {
  name: string;
  phone: string;
  parish: string;
  address: string;
}

interface InvoiceItem {
  name: string;
  vendorName?: string;
  storeName?: string;
  price: number;
  originalPrice?: number;
  discount?: DiscountSummary | null;
  qty: number;
}

@Component({
  selector: 'app-checkout-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Checkout</p>
          <h1>Final review and invoice</h1>
          <p>Confirm delivery details, place the order, and download a simple invoice.</p>
        </div>
      </section>

      <section class="container section split-grid checkout-grid">
        <div class="cart-panel">
          <h2>Order summary</h2>
          @if (cart.items().length === 0) {
            <div class="cart-empty">No items in cart. Add something before checking out.</div>
            <a class="button primary-button" routerLink="/marketplace">Browse marketplace</a>
          } @else {
            <ul class="cart-items">
              @for (item of cart.items(); track item.productId) {
                <li class="cart-item">
                  <div class="cart-item-info">
                    <strong>{{ item.name }}</strong>
                    <span>{{ item.vendorName }} - Qty {{ item.qty }}</span>
                    @if (hasDiscount(item)) {
                      <span class="product-meta">Discount applied: {{ discountLabel(item) }}</span>
                    }
                  </div>
                  <div class="price-block line-price">
                    @if (hasDiscount(item)) {
                      <span class="old-price">{{ money((item.originalPrice ?? item.price) * item.qty) }}</span>
                    }
                    <strong [class.discount-price]="hasDiscount(item)">{{ money(item.price * item.qty) }}</strong>
                  </div>
                </li>
              }
            </ul>
            <div class="cart-summary">
              <div>
                <span class="cart-label">Payment method</span>
                <strong>{{ paymentMethod }}</strong>
              </div>
              <div>
                <span class="cart-label">Payment status</span>
                <strong>{{ paymentStatusLabel() }}</strong>
              </div>
              <div>
                <span class="cart-label">Order total</span>
                <strong>{{ money(cart.total()) }}</strong>
              </div>
            </div>
          }
        </div>

        <form class="profile-form" (ngSubmit)="placeOrder()">
          <h2>Payment</h2>
          <div class="notice">
            <strong>{{ paymentMethod }}</strong>
            <p>{{ paymentMethod }} creates an Urban Market payment session for this order. Vendor Market Credits are held only after payment is confirmed.</p>
          </div>
          @if (order(); as paymentOrder) {
            <div class="stats-list">
              <div><strong>{{ paymentLabel(paymentOrder) }}</strong><span>Payment</span></div>
              <div><strong>{{ fulfillmentLabel(paymentOrder) }}</strong><span>Order stage</span></div>
              <div><strong>{{ paymentSessionId(paymentOrder) }}</strong><span>Payment session</span></div>
            </div>
          }

          <h2>Delivery details</h2>
          <label>
            Name
            <input name="name" [(ngModel)]="delivery.name" required>
          </label>
          <label>
            Phone
            <input name="phone" [(ngModel)]="delivery.phone" required>
          </label>
          <label>
            Parish
            <input name="parish" [(ngModel)]="delivery.parish" required>
          </label>
          <label>
            Delivery address
            <textarea name="address" [(ngModel)]="delivery.address" rows="4" required></textarea>
          </label>

          @if (order(); as confirmedOrder) {
            <div class="notice">
              <strong>Order {{ confirmedOrder.status }}</strong>
              <p>Payment session {{ paymentSessionId(confirmedOrder) }} is {{ confirmedOrder.paymentSessionStatus || confirmedOrder.paymentStatus || confirmedOrder.paymentSession?.status || 'pending' }}.</p>
              @if ((confirmedOrder.paymentStatus || confirmedOrder.paymentSession?.status) !== 'paid') {
                <p>Confirming the internal payment will create held Market Credits for each vendor.</p>
              } @else {
                <p>Invoice {{ confirmedOrder.invoiceNumber }} is ready with Urban Market JA and store details.</p>
                <a class="button secondary-button" [routerLink]="['/orders', confirmedOrder.orderId]">View order details</a>
              }
            </div>
          }

          @if (errorMessage()) {
            <div class="notice error">{{ errorMessage() }}</div>
          }

          <div class="checkout-actions">
            <button class="button secondary-button" type="button" [disabled]="cart.items().length === 0 && !order()" (click)="downloadInvoice()">Generate invoice</button>
            @if (canConfirmPayment()) {
              <button class="button primary-button" type="button" [disabled]="isConfirming()" (click)="confirmPayment()">{{ isConfirming() ? 'Confirming...' : 'Confirm internal payment' }}</button>
            } @else {
              <button class="button primary-button" type="submit" [disabled]="cart.items().length === 0 || isPlacing() || !!order()">{{ isPlacing() ? 'Placing...' : 'Place order' }}</button>
            }
          </div>
        </form>
      </section>
    </main>
  `
})
export class CheckoutPage implements OnInit {
  protected readonly cart = inject(CartService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly money = formatCurrency;
  protected readonly hasDiscount = hasDiscountPrice;
  protected readonly discountLabel = discountLabelFor;
  protected readonly isPlacing = signal(false);
  protected readonly isConfirming = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly order = signal<OrderResponse | null>(null);
  protected paymentMethod = 'Dime';

  protected delivery: DeliveryDetails = {
    name: '',
    phone: '',
    parish: '',
    address: ''
  };

  ngOnInit(): void {
    if (!this.auth.isSignedIn()) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: '/cart' } });
      return;
    }

    const user = this.auth.currentUser();
    this.delivery.name = user?.name || '';
    this.delivery.phone = user?.emailPhone && !user.emailPhone.includes('@') ? user.emailPhone : '';
  }

  protected async placeOrder(): Promise<void> {
    if (this.cart.items().length === 0) {
      return;
    }

    this.isPlacing.set(true);
    this.errorMessage.set('');

    try {
      await fetch(apiUrl('/api/customer/addresses'), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify({
          label: 'Checkout',
          recipientName: this.delivery.name,
          phone: this.delivery.phone,
          parish: this.delivery.parish,
          addressLine1: this.delivery.address,
          isDefault: true
        })
      }).catch(() => undefined);

      const response = await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify({
          customer: this.delivery,
          paymentMethod: this.paymentMethod,
          items: this.cart.items()
        })
      });

      if (!response.ok) {
        throw new Error('Order could not be placed.');
      }

      const confirmedOrder = await response.json() as OrderResponse;
      this.order.set(confirmedOrder);
      if ((confirmedOrder.paymentStatus || confirmedOrder.paymentSession?.status) === 'paid') {
        this.downloadInvoice(confirmedOrder);
        await this.cart.clear();
      }
    } catch {
      this.errorMessage.set('The backend order API did not accept the order. Keep the cart and try again.');
    } finally {
      this.isPlacing.set(false);
    }
  }

  protected canConfirmPayment(): boolean {
    const order = this.order();
    if (!order) return false;
    return (order.paymentStatus || order.paymentSession?.status) !== 'paid' && !!this.paymentSessionId(order);
  }

  protected paymentSessionId(order = this.order()): string {
    return order?.paymentSession?.id || order?.paymentSessionId || 'Pending';
  }

  protected paymentStatusLabel(): string {
    const order = this.order();
    return order?.paymentSessionStatus || order?.paymentStatus || order?.paymentSession?.status || 'Not started';
  }

  protected async confirmPayment(): Promise<void> {
    const currentOrder = this.order();
    const sessionId = this.paymentSessionId(currentOrder);
    if (!currentOrder || !sessionId || sessionId === 'Pending') return;

    this.isConfirming.set(true);
    this.errorMessage.set('');
    try {
      const response = await fetch(apiUrl(`/api/payments/sessions/${encodeURIComponent(sessionId)}/mock-pay`), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify({})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Payment could not be confirmed.');
      }
      const paidOrder = {
        ...currentOrder,
        ...(payload.order || {}),
        status: payload.order?.status || 'paid',
        paymentStatus: 'paid',
        paymentSessionStatus: 'paid',
        paymentSession: payload.session ? { ...payload.session, status: 'paid' } : { ...(currentOrder.paymentSession || {}), id: sessionId, status: 'paid' }
      } as OrderResponse;
      this.order.set(paidOrder);
      this.downloadInvoice(paidOrder);
      await this.cart.clear();
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Payment could not be confirmed.');
    } finally {
      this.isConfirming.set(false);
    }
  }

  protected downloadInvoice(order = this.order()): void {
    const invoiceNumber = order?.invoiceNumber ?? `INV-${Date.now()}`;
    const total = order?.total ?? this.cart.total();
    const items = order?.items ?? this.cart.items();
    const customer = order?.customer ?? this.delivery;
    const invoiceHtml = this.buildInvoiceHtml({
      invoiceNumber,
      orderId: order?.orderId ?? 'Pending order',
      createdAt: order?.createdAt ?? new Date().toISOString(),
      paymentMethod: order?.paymentMethod ?? this.paymentMethod,
      paymentStatus: order?.paymentStatus ?? order?.paymentSessionStatus ?? order?.paymentSession?.status ?? 'pending',
      orderStage: this.fulfillmentLabel(order),
      customer,
      items,
      total
    });

    const blob = new Blob([invoiceHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${invoiceNumber}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private buildInvoiceHtml(invoice: {
    invoiceNumber: string;
    orderId: string;
    createdAt: string;
    paymentMethod: string;
    paymentStatus: string;
    orderStage: string;
    customer: DeliveryDetails;
    items: InvoiceItem[];
    total: number;
  }): string {
    const stores = this.groupItemsByStore(invoice.items);
    const storeSections = stores.map((store) => {
      const rows = store.items.map((item) => `
        <tr>
          <td>${this.escapeHtml(item.name)}</td>
          <td>${item.qty}</td>
          <td>${this.invoicePriceHtml(item.price, item.originalPrice)}</td>
          <td>${this.invoicePriceHtml(item.price * item.qty, (item.originalPrice ?? item.price) * item.qty)}</td>
        </tr>
      `).join('');

      return `
        <section class="store-section">
          <h2>${this.escapeHtml(store.name)}</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr>
                <td colspan="3">Store subtotal</td>
                <td>${formatCurrency(store.subtotal)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      `;
    }).join('');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${this.escapeHtml(invoice.invoiceNumber)} - Urban Market JA Invoice</title>
  <style>
    body { margin: 0; padding: 32px; color: #1f2a24; font-family: Arial, sans-serif; background: #f7f4ed; }
    .invoice { max-width: 900px; margin: 0 auto; background: #fff; border: 1px solid #ded8ca; padding: 32px; }
    .header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 3px solid #f47a1f; padding-bottom: 24px; }
    .brand { display: flex; gap: 14px; align-items: center; }
    .logo { width: 72px; height: 58px; border-radius: 10px; background: #f6e3b3; border: 1px solid #e2d4b6; object-fit: contain; padding: 3px; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; margin-bottom: 12px; }
    .muted { color: #627267; margin-top: 4px; }
    .meta { text-align: right; line-height: 1.7; }
    .details { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 28px 0; }
    .panel { border: 1px solid #e5dfd2; padding: 16px; background: #fcfaf5; }
    .store-section { margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; background: #eef7f2; color: #244236; }
    th, td { border-bottom: 1px solid #e8e2d6; padding: 12px; }
    th:nth-child(2), td:nth-child(2) { text-align: center; }
    th:nth-child(3), th:nth-child(4), td:nth-child(3), td:nth-child(4) { text-align: right; }
    tfoot td { font-weight: 700; background: #fcfaf5; }
    .invoice-price { display: grid; gap: 2px; }
    .invoice-old-price { color: #7d7669; font-size: 12px; text-decoration: line-through; }
    .invoice-sale-price { color: #f47a1f; font-weight: 800; }
    .total { margin-top: 28px; display: flex; justify-content: flex-end; }
    .total-box { min-width: 260px; border-top: 3px solid #f47a1f; padding-top: 14px; text-align: right; }
    .total-box strong { font-size: 24px; display: block; margin-top: 4px; }
    .footer { margin-top: 32px; color: #627267; font-size: 13px; border-top: 1px solid #e5dfd2; padding-top: 16px; }
    @media print { body { background: white; padding: 0; } .invoice { border: 0; } }
  </style>
</head>
<body>
  <main class="invoice">
    <header class="header">
      <div class="brand">
        <img class="logo" src="/logo.jpeg" alt="Urban Market JA logo">
        <div>
          <h1>Urban Market JA</h1>
          <p class="muted">The Market Square</p>
        </div>
      </div>
      <div class="meta">
        <strong>Invoice ${this.escapeHtml(invoice.invoiceNumber)}</strong><br>
        Order ${this.escapeHtml(invoice.orderId)}<br>
        ${this.escapeHtml(new Date(invoice.createdAt).toLocaleString())}<br>
        ${this.escapeHtml(invoice.orderStage)}
      </div>
    </header>

    <section class="details">
      <div class="panel">
        <h2>Bill to</h2>
        <p>${this.escapeHtml(invoice.customer.name || 'Customer')}</p>
        <p>${this.escapeHtml(invoice.customer.phone || '')}</p>
        <p>${this.escapeHtml(invoice.customer.parish || '')}</p>
        <p>${this.escapeHtml(invoice.customer.address || '')}</p>
      </div>
      <div class="panel">
        <h2>Stores in this order</h2>
        <p>${stores.map((store) => this.escapeHtml(store.name)).join('<br>')}</p>
        <p class="muted">Payment method: ${this.escapeHtml(invoice.paymentMethod)}</p>
        <p class="muted">Payment status: ${this.escapeHtml(this.paymentLabel(invoice))}</p>
      </div>
    </section>

    ${storeSections}

    <section class="total">
      <div class="total-box">
        <span>Invoice total</span>
        <strong>${formatCurrency(invoice.total)}</strong>
      </div>
    </section>

    <footer class="footer">
      Generated by Urban Market JA. Each store section shows the vendor/store supplying those items.
    </footer>
  </main>
</body>
</html>`;
  }

  private groupItemsByStore(items: InvoiceItem[]): Array<{ name: string; items: InvoiceItem[]; subtotal: number }> {
    const grouped = new Map<string, { name: string; items: InvoiceItem[]; subtotal: number }>();
    for (const item of items) {
      const name = item.storeName || item.vendorName || 'Urban Market JA vendor';
      const group = grouped.get(name) ?? { name, items: [], subtotal: 0 };
      group.items.push(item);
      group.subtotal += item.price * item.qty;
      grouped.set(name, group);
    }
    return [...grouped.values()];
  }

  protected paymentLabel(order?: Partial<OrderResponse>): string {
    const status = order?.paymentStatus ?? this.order()?.paymentStatus ?? this.order()?.paymentSessionStatus ?? this.order()?.paymentSession?.status ?? 'pending';
    if (status === 'paid') return 'Paid';
    if (status === 'failed') return 'Payment failed';
    if (status === 'refunded') return 'Refunded';
    return 'Awaiting payment';
  }

  protected fulfillmentLabel(order?: Partial<OrderResponse> | null): string {
    const current = order ?? this.order();
    const paymentStatus = current?.paymentStatus ?? current?.paymentSessionStatus ?? current?.paymentSession?.status ?? 'pending';
    if (paymentStatus !== 'paid') return 'Awaiting payment confirmation';
    if (current?.status === 'completed') return 'Received and completed';
    if (current?.status === 'fulfilling') return 'Fulfillment in progress';
    return 'Paid - fulfillment pending';
  }

  private invoicePriceHtml(price: number, originalPrice?: number): string {
    const safePrice = Number(price || 0);
    const safeOriginal = Number(originalPrice ?? safePrice);
    if (safeOriginal <= safePrice) {
      return formatCurrency(safePrice);
    }
    return `<span class="invoice-price"><span class="invoice-old-price">${formatCurrency(safeOriginal)}</span><span class="invoice-sale-price">${formatCurrency(safePrice)}</span></span>`;
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
