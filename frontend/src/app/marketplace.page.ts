import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CartService } from './cart.service';
import { MarketApiService } from './market-api.service';
import { discountLabelFor, formatCurrency, hasDiscountPrice } from './market-data';

type MarketFilter = 'all' | 'products' | 'foods' | 'services';

@Component({
  selector: 'app-marketplace-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Marketplace</p>
          <h1>Products, food, services, and vendor stores</h1>
          <p>Browse local goods, ready food, services, and vendor storefronts from one place.</p>
        </div>
      </section>

      <section class="container section">
        <div class="section-heading">
          <h2>Featured vendors</h2>
          <p>Each storefront shows all products, business status, and share tools.</p>
        </div>
        <div class="vendor-grid">
          @for (vendor of vendors(); track vendor.id) {
            <article class="vendor-card">
              <div class="vendor-banner"><span class="visual-icon">Store</span>{{ vendor.categories.join(' + ') }}</div>
              <h3>{{ vendor.name }}</h3>
              <p class="vendor-meta">{{ vendor.rating }} star · {{ vendor.location }} · {{ vendor.deliveryDays.join(' / ') }}</p>
              <p>{{ vendor.summary }}</p>
              <a class="button secondary-button" [routerLink]="['/vendor', vendor.slug]">Enter store</a>
            </article>
          }
        </div>
      </section>

      <section class="container section">
        <div class="section-heading">
          <h2>All listings</h2>
          <p>Use filters to browse products, foods, or services without leaving the marketplace.</p>
        </div>

        <div class="job-filter-panel market-search-panel">
          <label>Search marketplace <input type="search" [(ngModel)]="search" placeholder="Search products, foods, services, or vendors"></label>
        </div>

        @if (market.error()) {
          <div class="notice error">{{ market.error() }}</div>
        }

        <div class="filter-bar market-filter-bar">
          @for (filter of filters; track filter.value) {
            <button class="filter-button" [class.active]="selectedFilter() === filter.value" type="button" (click)="selectedFilter.set(filter.value)">
              {{ filter.label }}
            </button>
          }
        </div>

        @if (showProducts()) {
          <div class="product-grid">
            @for (product of filteredProducts(); track product.id) {
              <article class="product-card">
                <div class="product-image"><span class="visual-icon">{{ labelFor(product.category) }}</span>{{ product.category }}</div>
                <p class="product-tag">Delivery: {{ product.deliveryDay }}</p>
                <h3>{{ product.name }}</h3>
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
                  <button class="button-sm" type="button" (click)="cart.addProduct(product)">Add</button>
                  <a class="button-sm light" [routerLink]="['/vendor', vendorSlug(product.vendorId)]">Store</a>
                </div>
              </article>
            }
          </div>
        }

        @if (showFoods()) {
          <div class="product-grid">
            @for (food of filteredFoods(); track food.id) {
              <article class="product-card">
                <div class="product-image"><span class="visual-icon">Food</span>Food</div>
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
        }

        @if (showServices()) {
          <div class="service-grid">
            @for (service of filteredServices(); track service.id) {
              <article class="service-card">
                <span class="card-icon">{{ service.category }}</span>
                <span class="product-tag">{{ service.category }}</span>
                <h3>{{ service.name }}</h3>
                <p class="product-meta">{{ service.vendor }} · {{ service.rating }} star</p>
                <p>{{ service.description }}</p>
                <div class="product-footer">
                  <strong>{{ money(service.price) }} {{ service.pricingType === 'Hourly' ? '/hr' : '' }}</strong>
                  <a class="button-sm" [routerLink]="['/services', service.id]">Book</a>
                </div>
              </article>
            }
          </div>
        }

        @if (!hasResults()) {
          <div class="cart-empty">No marketplace listings match your search.</div>
        }
      </section>
    </main>
  `
})
export class MarketplacePage implements OnInit {
  protected readonly market = inject(MarketApiService);
  protected readonly products = this.market.products;
  protected readonly foods = this.market.foods;
  protected readonly services = this.market.services;
  protected readonly vendors = this.market.vendors;
  protected readonly money = formatCurrency;
  protected readonly hasDiscount = hasDiscountPrice;
  protected readonly discountLabel = discountLabelFor;
  protected readonly selectedFilter = signal<MarketFilter>('all');
  protected search = '';
  protected readonly filters: Array<{ value: MarketFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'products', label: 'Products' },
    { value: 'foods', label: 'Foods' },
    { value: 'services', label: 'Services' }
  ];

  constructor(protected readonly cart: CartService) {}

  ngOnInit(): void {
    void this.market.loadMarketplace();
  }

  protected showProducts(): boolean {
    return this.selectedFilter() === 'all' || this.selectedFilter() === 'products';
  }

  protected showFoods(): boolean {
    return this.selectedFilter() === 'all' || this.selectedFilter() === 'foods';
  }

  protected showServices(): boolean {
    return this.selectedFilter() === 'all' || this.selectedFilter() === 'services';
  }

  protected filteredProducts() {
    return this.products()
      .filter((product) => product.category !== 'Food')
      .filter((product) => this.matchesSearch([
        product.name,
        product.description,
        product.category,
        this.vendorName(product.vendorId)
      ]));
  }

  protected filteredFoods() {
    return this.foods().filter((food) => this.matchesSearch([
      food.name,
      food.description,
      this.vendorName(food.vendorId),
      'food'
    ]));
  }

  protected filteredServices() {
    return this.services().filter((service) => this.matchesSearch([
      service.name,
      service.description,
      service.category,
      service.vendor
    ]));
  }

  protected hasResults(): boolean {
    return (this.showProducts() && this.filteredProducts().length > 0)
      || (this.showFoods() && this.filteredFoods().length > 0)
      || (this.showServices() && this.filteredServices().length > 0);
  }

  protected vendorName(vendorId: string): string {
    return this.market.vendorById(vendorId)?.name ?? 'Local vendor';
  }

  protected vendorSlug(vendorId: string): string {
    return this.market.vendorById(vendorId)?.slug ?? '';
  }

  protected labelFor(category: string): string {
    return category === 'Beauty' ? 'Beauty' : category === 'Food' ? 'Food' : 'Goods';
  }

  private matchesSearch(fields: Array<string | number | undefined>): boolean {
    const term = this.search.trim().toLowerCase();
    if (!term) return true;
    return fields.some((field) => String(field ?? '').toLowerCase().includes(term));
  }
}
