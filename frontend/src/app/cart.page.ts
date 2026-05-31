import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from './cart.service';
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
              @for (item of cart.items(); track item.productId) {
                <li class="cart-item">
                  <div class="cart-item-info">
                    @if (item.vendorSlug) {
                      <a class="product-name-link" [routerLink]="['/vendor', item.vendorSlug, 'product', item.productId]">{{ item.name }}</a>
                    } @else {
                      <strong>{{ item.name }}</strong>
                    }
                    <span>{{ item.vendorName }} · {{ item.deliveryDay }} delivery</span>
                    @if (hasDiscount(item)) {
                      <span class="product-meta">Discount applied: {{ discountLabel(item) }}</span>
                    }
                  </div>
                  <div class="quantity-control">
                    <button type="button" (click)="cart.updateQty(item.productId, item.qty - 1)">-</button>
                    <span>{{ item.qty }}</span>
                    <button type="button" (click)="cart.updateQty(item.productId, item.qty + 1)">+</button>
                  </div>
                  <div class="price-block line-price">
                    @if (hasDiscount(item)) {
                      <span class="old-price">{{ money((item.originalPrice ?? item.price) * item.qty) }}</span>
                    }
                    <strong [class.discount-price]="hasDiscount(item)">{{ money(item.price * item.qty) }}</strong>
                  </div>
                  <button class="button-sm danger" type="button" (click)="cart.remove(item.productId)">Remove</button>
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
}
