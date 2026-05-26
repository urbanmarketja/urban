import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MarketApiService } from './market-api.service';
import { formatCurrency } from './market-data';

@Component({
  selector: 'app-services-page',
  imports: [RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Services</p>
          <h1>Find trusted local services</h1>
          <p>Book delivery, home care, personal services, and errands without leaving the marketplace.</p>
        </div>
      </section>

      <section class="container section">
        <div class="section-heading">
          <h2>Available services</h2>
          <p>Choose a service category, review vendor details, and book directly.</p>
        </div>
        @if (market.error()) {
          <div class="notice error">{{ market.error() }}</div>
        }
        <div class="filter-bar">
          @for (category of categories(); track category) {
            <button class="filter-button" [class.active]="category === selectedCategory()" type="button" (click)="selectedCategory.set(category)">
              {{ category === 'all' ? 'All services' : category }}
            </button>
          }
        </div>
        <div class="service-grid">
          @for (service of filteredServices(); track service.id) {
            <article class="service-card">
              <span class="card-icon">{{ iconFor(service.category) }}</span>
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
      </section>
    </main>
  `
})
export class ServicesPage implements OnInit {
  protected readonly market = inject(MarketApiService);
  protected readonly services = this.market.services;
  protected readonly money = formatCurrency;
  protected readonly selectedCategory = signal('all');
  protected readonly categories = computed(() => ['all', ...Array.from(new Set(this.services().map((service) => service.category)))]);

  ngOnInit(): void {
    void this.market.loadMarketplace();
  }

  protected filteredServices() {
    return this.selectedCategory() === 'all'
      ? this.services()
      : this.services().filter((service) => service.category === this.selectedCategory());
  }

  protected iconFor(category: string): string {
    if (category.includes('Delivery')) return '🚚';
    if (category.includes('Home')) return '🔧';
    if (category.includes('Personal')) return '✨';
    return '📦';
  }
}
