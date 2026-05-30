import { Injectable, computed, inject, signal } from '@angular/core';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { DiscountSummary, Product } from './market-data';

export interface CartItem {
  productId: string;
  name: string;
  vendorId: string;
  vendorName: string;
  price: number;
  originalPrice?: number;
  discount?: DiscountSummary | null;
  deliveryDay: string;
  qty: number;
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

  async addProduct(product: Product): Promise<void> {
    const previous = [...this.itemsSignal()];
    const next = [...this.itemsSignal()];
    const existing = next.find((item) => item.productId === product.id);

    if (existing) {
      existing.qty += 1;
    } else {
      next.push({
        productId: product.id,
        name: product.name,
        vendorId: product.vendorId,
        vendorName: product.vendorName ?? 'Local vendor',
        price: product.price,
        originalPrice: product.originalPrice ?? product.price,
        discount: product.discount ?? null,
        deliveryDay: product.deliveryDay,
        qty: 1
      });
    }

    this.saveCart(next);
    if (this.shouldSync()) {
      const ok = await this.post('/api/cart/items', { productId: product.id, qty: 1 });
      if (!ok) this.saveCart(previous);
    }
  }

  async updateQty(productId: string, qty: number): Promise<void> {
    const previous = [...this.itemsSignal()];
    const normalizedQty = Math.max(1, Math.floor(qty || 1));
    this.saveCart(this.itemsSignal().map((item) => item.productId === productId ? { ...item, qty: normalizedQty } : item));
    if (this.shouldSync()) {
      const ok = await this.post(`/api/cart/items/${productId}`, { qty: normalizedQty });
      if (!ok) this.saveCart(previous);
    }
  }

  async remove(productId: string): Promise<void> {
    const previous = [...this.itemsSignal()];
    this.saveCart(this.itemsSignal().filter((item) => item.productId !== productId));
    if (this.shouldSync()) {
      const ok = await this.post(`/api/cart/items/${productId}/remove`, {});
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
      await this.post('/api/cart/items', { productId: item.productId, qty: item.qty });
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
