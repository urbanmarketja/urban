import { Injectable, computed, inject, signal } from '@angular/core';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { DiscountSummary, Product, formatCurrency } from './market-data';

export interface CartItem {
  productId: string;
  name: string;
  vendorId: string;
  vendorName: string;
  vendorSlug?: string;
  price: number;
  originalPrice?: number;
  discount?: DiscountSummary | null;
  deliveryDay: string;
  qty: number;
  customizationSignature?: string;
  customizationSummary?: string;
  customizationAddOnTotal?: number;
  customizations?: unknown[];
  customizationPreviews?: unknown[];
}

export interface CartCustomizationAdd {
  customizations?: Record<string, unknown> | unknown[];
  previews?: unknown[];
  validation?: {
    customizationSignature?: string;
    customizations?: unknown[];
    previews?: unknown[];
    addOnTotalJmd?: number;
  };
}

const CART_KEY = 'urbanMarketCart';
const CART_SYNC_USER_KEY = 'urbanMarketCartSyncedUser';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly auth = inject(AuthService);
  private readonly itemsSignal = signal<CartItem[]>(this.loadCart());
  private readonly errorSignal = signal('');

  readonly items = this.itemsSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly count = computed(() => this.itemsSignal().reduce((sum, item) => sum + item.qty, 0));
  readonly total = computed(() => this.itemsSignal().reduce((sum, item) => sum + item.price * item.qty, 0));

  constructor() {
    if (this.shouldSync()) {
      void this.refresh();
    }
  }

  async addProduct(product: Product, customization?: CartCustomizationAdd): Promise<void> {
    const previous = [...this.itemsSignal()];
    const next = [...this.itemsSignal()];
    const signature = customization?.validation?.customizationSignature || '';
    const addOnTotal = Number(customization?.validation?.addOnTotalJmd || 0);
    const existing = next.find((item) => item.productId === product.id && (item.customizationSignature || '') === signature);

    if (existing) {
      existing.qty += 1;
    } else {
      next.push({
        productId: product.id,
        name: product.name,
        vendorId: product.vendorId,
        vendorName: product.vendorName ?? 'Local vendor',
        vendorSlug: product.vendorSlug || product.storeSlug,
        price: product.price + addOnTotal,
        originalPrice: (product.originalPrice ?? product.price) + addOnTotal,
        discount: product.discount ?? null,
        deliveryDay: product.deliveryDay,
        qty: 1,
        customizationSignature: signature,
        customizationSummary: this.customizationSummary(customization),
        customizationAddOnTotal: addOnTotal,
        customizations: customization?.validation?.customizations || [],
        customizationPreviews: customization?.validation?.previews || customization?.previews || []
      });
    }

    this.saveCart(next);
    if (this.shouldSync()) {
      const ok = await this.post('/api/cart/items', {
        productId: product.id,
        qty: 1,
        customizations: customization?.customizations || {},
        previews: customization?.previews || []
      });
      if (!ok) this.saveCart(previous);
    }
  }

  async updateQty(productId: string, qty: number, customizationSignature = ''): Promise<void> {
    const previous = [...this.itemsSignal()];
    const normalizedQty = Math.max(1, Math.floor(qty || 1));
    this.saveCart(this.itemsSignal().map((item) => item.productId === productId && (item.customizationSignature || '') === customizationSignature ? { ...item, qty: normalizedQty } : item));
    if (this.shouldSync()) {
      const ok = await this.post(`/api/cart/items/${productId}`, { qty: normalizedQty, customizationSignature });
      if (!ok) this.saveCart(previous);
    }
  }

  async remove(productId: string, customizationSignature = ''): Promise<void> {
    const previous = [...this.itemsSignal()];
    this.saveCart(this.itemsSignal().filter((item) => !(item.productId === productId && (item.customizationSignature || '') === customizationSignature)));
    if (this.shouldSync()) {
      const suffix = customizationSignature ? `?customizationSignature=${encodeURIComponent(customizationSignature)}` : '';
      const ok = await this.post(`/api/cart/items/${productId}/remove${suffix}`, {});
      if (!ok) this.saveCart(previous);
    }
  }

  async clear(): Promise<void> {
    const previous = [...this.itemsSignal()];
    this.saveCart([]);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CART_SYNC_USER_KEY);
    }
    if (this.shouldSync()) {
      const ok = await this.post('/api/cart/clear', {});
      if (!ok) this.saveCart(previous);
    }
  }

  async syncLocalCartToAccount(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || user.role !== 'customer') return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(CART_SYNC_USER_KEY) === user.id) return;

    const localItems = [...this.itemsSignal()];
    for (const item of localItems) {
      await this.post('/api/cart/items', {
        productId: item.productId,
        qty: item.qty,
        customizations: item.customizations || {},
        previews: item.customizationPreviews || []
      });
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CART_SYNC_USER_KEY, user.id);
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.shouldSync()) {
      this.errorSignal.set('');
      return;
    }
    try {
      const response = await fetch(apiUrl('/api/cart'), { headers: this.auth.authHeaders() });
      if (!response.ok) return;
      const cart = await response.json() as { items: CartItem[] };
      this.saveCart(cart.items || []);
      this.errorSignal.set('');
    } catch {
      this.errorSignal.set('Cart API is unavailable.');
    }
  }

  private loadCart(): CartItem[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    try {
      const raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) as CartItem[] : [];
    } catch {
      return [];
    }
  }

  private saveCart(items: CartItem[]): void {
    this.itemsSignal.set(items);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    }
  }

  itemKey(item: CartItem): string {
    return `${item.productId}:${item.customizationSignature || ''}`;
  }

  private customizationSummary(customization?: CartCustomizationAdd): string {
    const rows = customization?.validation?.customizations || [];
    if (!Array.isArray(rows) || !rows.length) return '';
    return rows
      .map((row: any) => {
        const amount = Number(row.priceDeltaJmd || 0);
        const suffix = amount > 0 ? ` (+${formatCurrency(amount)})` : '';
        return `${row.fieldLabel || row.fieldKey}: ${row.valueText || ''}${suffix}`;
      })
      .filter(Boolean)
      .join(', ');
  }

  private shouldSync(): boolean {
    return this.auth.currentUser()?.role === 'customer';
  }

  private async post(path: string, body: unknown): Promise<boolean> {
    try {
      const response = await fetch(apiUrl(path), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        if (payload.items) {
          this.saveCart(payload.items);
        }
        this.errorSignal.set('');
        return true;
      }
      this.errorSignal.set(payload.error || 'Cart could not be synced.');
      return false;
    } catch (error) {
      this.errorSignal.set(error instanceof Error ? error.message : 'Cart could not be synced.');
      return false;
    }
  }
}
