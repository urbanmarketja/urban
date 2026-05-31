import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CartService } from './cart.service';
import { MarketApiService } from './market-api.service';
import { Product, ProductImage, discountLabelFor, formatCurrency, hasDiscountPrice } from './market-data';

@Component({
  selector: 'app-product-detail-page',
  imports: [RouterLink],
  template: `
    <main>
      @if (product(); as item) {
        <section class="container section product-detail-shell">
          <nav class="breadcrumb-row" aria-label="Product path">
            <a routerLink="/marketplace">Marketplace</a>
            <span>/</span>
            <a [routerLink]="['/vendor', storeSlug()]">{{ item.storeName || item.vendorName || 'Store' }}</a>
            <span>/</span>
            <span>{{ item.name }}</span>
          </nav>

          <div class="product-detail-grid">
            <section class="product-gallery-panel">
              <div class="product-detail-image" [class.has-photo]="selectedImage()">
                @if (selectedImage()) {
                  <img [src]="selectedImage()" [alt]="item.name" loading="eager" decoding="async">
                } @else {
                  <span class="visual-icon">{{ labelFor(item.category) }}</span>{{ item.category }}
                }
              </div>
              @if (galleryImages().length > 1) {
                <div class="product-gallery-thumbs" aria-label="Product photos">
                  @for (image of galleryImages(); track image.url) {
                    <button type="button" [class.active]="selectedImage() === image.url" (click)="selectedImage.set(image.url)">
                      <img [src]="image.url" [alt]="image.altText || item.name" loading="lazy" decoding="async">
                    </button>
                  }
                </div>
              }
            </section>

            <section class="dashboard-card product-detail-card">
              <p class="product-tag">{{ item.category }}</p>
              <h1>{{ item.name }}</h1>
              <p class="product-meta">
                Sold by
                <a [routerLink]="['/vendor', storeSlug()]">{{ item.storeName || item.vendorName || 'Urban Market JA store' }}</a>
                - {{ item.rating }} star
              </p>

              <div class="price-block product-detail-price">
                @if (hasDiscount(item)) {
                  <span class="old-price">{{ money(item.originalPrice ?? item.price) }}</span>
                }
                <strong [class.discount-price]="hasDiscount(item)">{{ money(item.price) }}</strong>
                @if (hasDiscount(item)) {
                  <span class="discount-badge">{{ discountLabel(item) }}</span>
                }
              </div>

              <div class="store-highlight-grid product-detail-facts">
                <div><strong>{{ item.deliveryDay }}</strong><span>Delivery or pickup</span></div>
                <div><strong>{{ stockLabel(item) }}</strong><span>Stock status</span></div>
              </div>

              <div class="product-detail-description">
                <h2>Description</h2>
                <p>{{ item.description }}</p>
              </div>

              <div class="share-actions">
                <button class="button primary-button" type="button" (click)="cart.addProduct(item)">Add to cart</button>
                <a class="button secondary-button" [routerLink]="['/vendor', storeSlug()]">Visit store</a>
              </div>
            </section>
          </div>
        </section>
      } @else if (isLoading()) {
        <section class="container section">
          <div class="cart-empty">Loading product details...</div>
        </section>
      } @else {
        <section class="container section">
          <div class="cart-empty">Product not found or no longer available.</div>
          <a class="button primary-button" routerLink="/marketplace">Back to marketplace</a>
        </section>
      }
    </main>
  `
})
export class ProductDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly market = inject(MarketApiService);
  protected readonly cart = inject(CartService);
  protected readonly product = signal<Product | null>(null);
  protected readonly selectedImage = signal('');
  protected readonly isLoading = signal(true);
  protected readonly money = formatCurrency;
  protected readonly hasDiscount = hasDiscountPrice;
  protected readonly discountLabel = discountLabelFor;

  protected readonly galleryImages = computed<ProductImage[]>(() => {
    const item = this.product();
    if (!item) return [];
    const seen = new Set<string>();
    return [
      ...(item.imageUrl ? [{ url: item.imageUrl, altText: item.name, sortOrder: -1 }] : []),
      ...(item.images || [])
    ].filter((image) => {
      if (!image.url || seen.has(image.url)) return false;
      seen.add(image.url);
      return true;
    });
  });

  ngOnInit(): void {
    void this.loadProduct();
  }

  protected storeSlug(): string {
    const item = this.product();
    return item?.storeSlug || item?.vendorSlug || this.route.snapshot.paramMap.get('slug') || '';
  }

  protected stockLabel(item: Product): string {
    const stock = Number(item.stockQuantity || 0);
    return stock > 0 ? `${stock} available` : 'Ask store';
  }

  protected labelFor(category: string): string {
    return category === 'Food' ? 'Food' : category === 'Beauty' ? 'Beauty' : 'Goods';
  }

  private async loadProduct(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') || '';
    if (!id) {
      this.isLoading.set(false);
      return;
    }

    await this.market.loadMarketplace();
    const cached = this.market.productById(id);
    if (cached) this.setProduct(cached);

    const loaded = await this.market.loadProduct(id);
    if (loaded) this.setProduct(loaded);
    this.isLoading.set(false);
  }

  private setProduct(item: Product): void {
    this.product.set(item);
    const firstImage = this.galleryImages()[0]?.url || '';
    this.selectedImage.set(firstImage);
  }
}
