import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from './cart.service';
import { MarketApiService } from './market-api.service';
import { discountLabelFor, formatCurrency, hasDiscountPrice } from './market-data';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  template: `
    <main>
      <section class="hero-section container">
        <div class="hero-copy">
          <p class="eyebrow">The Market Square // Kingston · Mobay · Ochi</p>
          <h1>Street-side commerce, <em>built local</em>.</h1>
          <p class="hero-text">Shop products, book services, taste island foods, and manage every order from one marketplace built for Jamaica's independent vendors and crews.</p>
          <div class="hero-actions">
            <a class="button primary-button" routerLink="/marketplace">Browse the market</a>
            <a class="button secondary-button" routerLink="/signup">Open a vendor stall</a>
          </div>
        </div>
        <div class="hero-summary-cards commerce-stack">
          <article class="hero-store-card">
            <span class="product-tag">Live · Marketplace</span>
            <h2>One Market<br>One Square</h2>
            <p>Products, foods, services, jobs, vendor wallets, and storefront sharing — running in one operating system.</p>
          </article>
          <article><strong>{{ vendors().length }}+</strong><span>Featured vendor stores</span></article>
          <article><strong>24/7</strong><span>Cart · Alerts · Invoices · Dashboards</span></article>
        </div>
      </section>

      <section class="container section category-tiles">
        <div class="section-heading">
          <p class="eyebrow">Pick your lane</p>
          <h2>Entry points</h2>
          <p>Choose your door into Urban Market JA.</p>
        </div>
        <div class="tiles-grid">
          <a routerLink="/marketplace" class="tile-card tile-market">
            <span class="tile-icon">Shop</span>
            <h3>Shop products</h3>
            <p>Browse local goods, groceries, and everyday essentials.</p>
          </a>
          <a routerLink="/services" class="tile-card tile-services">
            <span class="tile-icon">Book</span>
            <h3>Book services</h3>
            <p>Find delivery, home support, grooming, and errands.</p>
          </a>
          <a routerLink="/foods" class="tile-card tile-foods">
            <span class="tile-icon">Food</span>
            <h3>Order food</h3>
            <p>Island meals, snack packs, and breakfast boxes.</p>
          </a>
          <a routerLink="/jobs" class="tile-card tile-jobs">
            <span class="tile-icon">Work</span>
            <h3>Find jobs</h3>
            <p>See local opportunities from vendors and partners.</p>
          </a>
        </div>
      </section>

      <section class="container section">
        <div class="section-heading">
          <p class="eyebrow">Hand-picked</p>
          <h2>Featured products</h2>
          <p>Every product links back to its vendor storefront.</p>
        </div>
        @if (market.error()) {
          <div class="notice error">{{ market.error() }}</div>
        }
        <div class="product-grid">
          @for (product of featuredProducts(); track product.id) {
            <article class="product-card">
              <a class="product-image product-image-link" [class.has-photo]="product.imageUrl" [routerLink]="['/vendor', product.storeSlug || vendorSlug(product.vendorId), 'product', product.id]">
                @if (product.imageUrl) {
                  <img [src]="product.imageUrl" [alt]="product.name" loading="lazy" decoding="async">
                } @else {
                  <span class="visual-icon">{{ iconFor(product.category) }}</span>{{ product.category }}
                }
              </a>
              <p class="product-tag">Delivery: {{ product.deliveryDay }}</p>
              <h3><a class="product-name-link" [routerLink]="['/vendor', product.storeSlug || vendorSlug(product.vendorId), 'product', product.id]">{{ product.name }}</a></h3>
              <p>{{ product.description }}</p>
              <p class="product-meta">{{ vendorName(product.vendorId) }} · {{ product.rating }} star</p>
              <div class="product-footer">
                <div class="price-block">
                  @if (hasDiscount(product)) {
                    <span class="old-price">{{ money(product.originalPrice ?? product.price) }}</span>
                  }
                  <strong [class.discount-price]="hasDiscount(product)">{{ money(product.price) }}</strong>
                  @if (hasDiscount(product)) {
                    <span class="discount-badge">{{ discountLabel(product) }}</span>
                  }
                </div>
                @if (product.isCustomizable) {
                  <a class="button-sm" [routerLink]="['/vendor', product.storeSlug || vendorSlug(product.vendorId), 'product', product.id]">Customize</a>
                } @else {
                  <button class="button-sm" type="button" (click)="cart.addProduct(product)">Add</button>
                }
                <a class="button-sm light" [routerLink]="['/vendor', vendorSlug(product.vendorId)]">Store</a>
              </div>
            </article>
          }
        </div>
      </section>
    </main>
  `
})
export class HomePage implements OnInit {
  protected readonly market = inject(MarketApiService);
  protected readonly vendors = this.market.vendors;
  protected readonly featuredProducts = () => this.market.products().slice(0, 3);
  protected readonly money = formatCurrency;
  protected readonly hasDiscount = hasDiscountPrice;
  protected readonly discountLabel = discountLabelFor;

  constructor(protected readonly cart: CartService) {}

  ngOnInit(): void {
    void this.market.loadMarketplace();
  }

  protected vendorName(vendorId: string): string {
    return this.market.vendorById(vendorId)?.name ?? 'Local vendor';
  }

  protected vendorSlug(vendorId: string): string {
    return this.market.vendorById(vendorId)?.slug ?? '';
  }

  protected iconFor(category: string): string {
    return category === 'Food' ? 'Food' : category === 'Beauty' ? 'Beauty' : 'Goods';
  }
}
