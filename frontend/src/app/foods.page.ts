import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MarketApiService } from './market-api.service';
import { discountLabelFor, formatCurrency, hasDiscountPrice } from './market-data';

@Component({
  selector: 'app-foods-page',
  imports: [RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Fresh food</p>
          <h1>Island meals and quick bites</h1>
          <p>Order ready meals, snack packs, and breakfast boxes from local food vendors.</p>
        </div>
      </section>

      <section class="container section">
        <div class="section-heading">
          <h2>Food offerings</h2>
          <p>Explore ready-to-eat meals, snacks, and seasonal fruit packages.</p>
        </div>
        @if (market.error()) {
          <div class="notice error">{{ market.error() }}</div>
        }
        <div class="product-grid">
          @for (food of foods(); track food.id) {
            <article class="product-card">
              <div class="product-image"><span class="visual-icon">🍽️</span>Food</div>
              <h3>{{ food.name }}</h3>
              <p>{{ food.description }}</p>
              <p class="product-meta">{{ vendorName(food.vendorId) }}</p>
              <div class="product-footer">
                <div class="price-block">
                  @if (hasDiscount(food)) {
                    <span class="old-price">{{ money(food.originalPrice ?? food.price) }}</span>
                  }
                  <strong [class.discount-price]="hasDiscount(food)">{{ money(food.price) }}</strong>
                  @if (hasDiscount(food)) {
                    <span class="discount-badge">{{ discountLabel(food) }}</span>
                  }
                </div>
                <a class="button-sm light" [routerLink]="['/vendor', vendorSlug(food.vendorId)]">Store</a>
              </div>
            </article>
          }
        </div>
      </section>
    </main>
  `
})
export class FoodsPage implements OnInit {
  protected readonly market = inject(MarketApiService);
  protected readonly foods = this.market.foods;
  protected readonly money = formatCurrency;
  protected readonly hasDiscount = hasDiscountPrice;
  protected readonly discountLabel = discountLabelFor;

  ngOnInit(): void {
    void this.market.loadMarketplace();
  }

  protected vendorName(vendorId: string): string {
    return this.market.vendorById(vendorId)?.name ?? 'Local vendor';
  }

  protected vendorSlug(vendorId: string): string {
    return this.market.vendorById(vendorId)?.slug ?? '';
  }
}
