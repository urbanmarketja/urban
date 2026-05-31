import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartItem, CartService } from './cart.service';
import { discountLabelFor, formatCurrency, hasDiscountPrice } from './market-data';

@Component({
  selector: 'app-cart-page',
  imports: [RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Cart</p>
          <h1>Your cart is ready</h1>
          <p>Review items, update quantities, and move to checkout.</p>
        </div>
      </section>

      <section class="container section">
        <div class="cart-panel">
          @if (cart.error()) {
            <div class="notice error">{{ cart.error() }}</div>
          }
          @if (cart.items().length === 0) {
            <div class="cart-empty">Your cart is empty. Add a product to get started.</div>
            <a class="button primary-button" routerLink="/marketplace">Browse marketplace</a>
          } @else {
            <ul class="cart-items">
              @for (item of cart.items(); track cart.itemKey(item)) {
                <li class="cart-item">
                  @if (customizationPreviewImage(item)) {
                    <div class="cart-custom-preview">
                      <img [src]="customizationPreviewImage(item)" [alt]="item.name + ' customization preview'" loading="lazy" decoding="async">
                    </div>
                  }
                  <div class="cart-item-info">
                    @if (item.vendorSlug) {
                      <a class="product-name-link" [routerLink]="['/vendor', item.vendorSlug, 'product', item.productId]">{{ item.name }}</a>
                    } @else {
                      <strong>{{ item.name }}</strong>
                    }
                    <span>{{ item.vendorName }} - {{ item.deliveryDay }} delivery</span>
                    @if (hasDiscount(item)) {
                      <span class="product-meta">Discount applied: {{ discountLabel(item) }}</span>
                    }
                    @if (item.customizationSummary) {
                      <span class="product-meta">Custom: {{ item.customizationSummary }}</span>
                    }
                    @if (item.customizationAddOnTotal) {
                      <span class="product-meta">Customization add-ons: {{ money(item.customizationAddOnTotal) }}</span>
                    }
                    @if (item.customizationSignature && item.vendorSlug) {
                      <a class="button-sm secondary-button cart-edit-link" [routerLink]="['/vendor', item.vendorSlug, 'product', item.productId]" [queryParams]="{ editCart: item.customizationSignature }">Edit customization</a>
                    }
                  </div>
                  <div class="quantity-control">
                    <button type="button" (click)="cart.updateQty(item.productId, item.qty - 1, item.customizationSignature || '')">-</button>
                    <span>{{ item.qty }}</span>
                    <button type="button" (click)="cart.updateQty(item.productId, item.qty + 1, item.customizationSignature || '')">+</button>
                  </div>
                  <div class="price-block line-price">
                    @if (hasDiscount(item)) {
                      <span class="old-price">{{ money((item.originalPrice ?? item.price) * item.qty) }}</span>
                    }
                    <strong [class.discount-price]="hasDiscount(item)">{{ money(item.price * item.qty) }}</strong>
                  </div>
                  <button class="button-sm danger" type="button" (click)="cart.remove(item.productId, item.customizationSignature || '')">Remove</button>
                </li>
              }
            </ul>

            <div class="cart-summary">
              <div>
                <span class="cart-label">Total</span>
                <strong>{{ money(cart.total()) }}</strong>
              </div>
              <a class="button primary-button" routerLink="/checkout">Go to checkout</a>
            </div>
          }
        </div>
      </section>
    </main>
  `
})
export class CartPage implements OnInit {
  protected readonly cart = inject(CartService);
  protected readonly money = formatCurrency;
  protected readonly hasDiscount = hasDiscountPrice;
  protected readonly discountLabel = discountLabelFor;

  ngOnInit(): void {
    void this.cart.syncLocalCartToAccount();
  }

  protected customizationPreviewImage(item: CartItem): string {
    const preview = this.firstCustomizationPreview(item);
    const json = preview?.previewJson || {};
    return String(preview?.previewImageUrl || json.baseImageUrl || json.imageUrl || json.url || '');
  }

  private firstCustomizationPreview(item: CartItem): any | null {
    const previews = Array.isArray(item.customizationPreviews) ? item.customizationPreviews : [];
    return previews.find((preview) => preview && typeof preview === 'object') || null;
  }
}
