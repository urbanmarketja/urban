import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';
import {
  Coordinates,
  distanceKm,
  formatDistance,
  mapsDirectionsUrl,
  mapsEmbedUrl,
  mapsSearchUrl,
  resolveCoordinates
} from './location-utils';
import { MarketApiService } from './market-api.service';
import { Vendor, discountLabelFor, formatCurrency, hasDiscountPrice } from './market-data';

interface CustomerAddress {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2?: string | null;
  parish?: string | null;
  isDefault: boolean;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

@Component({
  selector: 'app-vendor-store-page',
  imports: [RouterLink],
  template: `
    <main>
      @if (vendor(); as store) {
        <section class="page-hero store-hero" [class.has-store-banner]="store.bannerUrl" [style.background-image]="storeHeroBackground(store)">
          <div class="container page-header">
            @if (store.logoUrl) {
              <img class="store-logo-avatar" [src]="store.logoUrl" [alt]="store.name + ' logo'">
            }
            <p class="eyebrow">Vendor store</p>
            <h1>{{ store.name }}</h1>
            <p>{{ store.summary }}</p>
            <p class="vendor-meta">{{ store.rating }} star - {{ storeAddressLabel() }} - Delivery {{ store.deliveryDays.join(' / ') }}</p>
          </div>
        </section>

        <section class="container section store-detail-grid">
          <article class="dashboard-card store-customer-card">
            <div class="store-card-header">
              <div>
                <span class="product-tag">{{ store.categories.join(' + ') }}</span>
                <h2>About {{ store.name }}</h2>
              </div>
              <span class="status-pill" [class.warn]="store.registrationStatus !== 'registered'">{{ customerTrustLabel(store) }}</span>
            </div>
            <p>{{ store.summary }}</p>
            <div class="store-highlight-grid">
              <div><strong>{{ store.rating }} star</strong><span>Customer rating</span></div>
              <div><strong>{{ store.deliveryDays.join(' / ') }}</strong><span>Delivery days</span></div>
              <div><strong>{{ storeProducts().length }}</strong><span>Items available</span></div>
              <div><strong>{{ store.categories.join(' + ') }}</strong><span>Store type</span></div>
            </div>
            @if (store.registrationStatus === 'unregistered') {
              <div class="notice store-customer-note">
                <strong>Business registration support in progress</strong>
                <p>This store is operating inside Urban Market JA's vendor support window while registration assistance is available.</p>
              </div>
            }

            <div class="store-action-panel store-share-inline">
              <div class="store-action-summary">
                <div>
                  <h3>Share and follow</h3>
                  <p>Send this storefront, save it for later, or follow the store online.</p>
                </div>
                <button
                  class="button secondary-button"
                  type="button"
                  [attr.aria-expanded]="shareDetailsOpen()"
                  (click)="toggleShareDetails()"
                >
                  {{ shareDetailsOpen() ? 'Hide share options' : 'Share store' }}
                </button>
              </div>
              @if (shareDetailsOpen()) {
                <div class="store-action-details">
                  <div class="share-actions">
                    <button class="button secondary-button" type="button" (click)="copyStoreLink()">{{ copyLabel() }}</button>
                    <a class="button outline-button" [href]="whatsappShare()" target="_blank" rel="noopener">WhatsApp</a>
                    <a class="button outline-button" [href]="facebookShare()" target="_blank" rel="noopener">Facebook</a>
                  </div>
                  <div class="qr-box store-qr-compact">
                    <img [src]="qrUrl()" alt="QR code for vendor store link">
                    <span>Scan to reopen this store on another device.</span>
                  </div>
                  @if (socialLinks(store).length) {
                    <div class="follow-us-panel">
                      <h3>Follow us</h3>
                      <div class="social-chip-list">
                        @for (link of socialLinks(store); track link.platform) {
                          <a class="social-chip" [href]="link.url" target="_blank" rel="noopener">
                            <span class="social-icon" [attr.data-platform]="link.platform">{{ socialIcon(link.platform) }}</span>
                            <span>{{ link.label || socialName(link.platform) }}</span>
                          </a>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </article>

          <article class="dashboard-card store-map-card">
            <div class="store-card-header">
              <div>
                <span class="product-tag">Location</span>
                <h2>Pickup, delivery, and directions</h2>
              </div>
              <button
                class="button secondary-button"
                type="button"
                [attr.aria-expanded]="locationDetailsOpen()"
                (click)="toggleLocationDetails()"
              >
                {{ locationDetailsOpen() ? 'Hide location' : 'Show location' }}
              </button>
            </div>
            <p class="product-meta">View the store area, estimate distance, or open directions when you need it.</p>
            @if (locationDetailsOpen()) {
              <div class="store-action-details">
                <p><strong>{{ storeAddressLabel() }}</strong></p>
                <div class="map-frame">
                  <iframe title="Store map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" [src]="safeMapUrl()"></iframe>
                </div>
                <div class="stats-list">
                  <div>
                    <strong>{{ distanceLabel() }}</strong>
                    <span>{{ distanceNote() }}</span>
                  </div>
                </div>
                @if (locationMessage()) {
                  <div class="notice">{{ locationMessage() }}</div>
                }
                <div class="share-actions">
                  <button class="button secondary-button" type="button" (click)="useCurrentLocation()">Use my location</button>
                  <a class="button primary-button" [href]="directionsUrl()" target="_blank" rel="noopener">Directions</a>
                  <a class="button outline-button" [href]="mapSearchUrl()" target="_blank" rel="noopener">Open map</a>
                </div>
              </div>
            }
          </article>
        </section>

        @if (store.galleryMedia?.length) {
          <section class="container section store-gallery-section">
            <div class="section-heading">
              <h2>Store gallery</h2>
              <p>Photos shared by {{ store.name }}.</p>
            </div>
            <div class="store-gallery-grid">
              @for (media of store.galleryMedia; track media.id || media.url) {
                <figure>
                  <img [src]="media.url" [alt]="media.altText || store.name + ' store photo'" loading="lazy" decoding="async">
                </figure>
              }
            </div>
          </section>
        }

        <section class="container section">
          <div class="section-heading">
            <h2>Shop {{ store.name }}</h2>
            <p>Browse available goods from this store and add items to your cart.</p>
          </div>
          <div class="product-grid">
            @for (product of storeProducts(); track product.id) {
              <article class="product-card">
                <div class="product-image" [class.has-photo]="product.imageUrl">
                  @if (product.imageUrl) {
                    <img [src]="product.imageUrl" [alt]="product.name" loading="lazy" decoding="async">
                  } @else {
                    <span class="visual-icon">{{ iconFor(product.category) }}</span>{{ product.category }}
                  }
                </div>
                <p class="product-tag">Delivery: {{ product.deliveryDay }}</p>
                <h3>{{ product.name }}</h3>
                <p>{{ product.description }}</p>
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
                  <button class="button-sm" type="button" (click)="cart.addProduct(product)">Add to cart</button>
                </div>
              </article>
            }
          </div>
        </section>
      } @else {
        <section class="container section">
          <h1>Store not found</h1>
          <a routerLink="/marketplace">Back to marketplace</a>
        </section>
      }
    </main>
  `
})
export class VendorStorePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly market = inject(MarketApiService);
  private readonly auth = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly cart = inject(CartService);
  protected readonly copyLabel = signal('Copy link');
  protected readonly shareDetailsOpen = signal(false);
  protected readonly locationDetailsOpen = signal(false);
  protected readonly customerAddresses = signal<CustomerAddress[]>([]);
  protected readonly visitorLocation = signal<Coordinates | null>(null);
  protected readonly locationMessage = signal('');
  protected readonly money = formatCurrency;
  protected readonly hasDiscount = hasDiscountPrice;
  protected readonly discountLabel = discountLabelFor;

  ngOnInit(): void {
    void this.market.loadMarketplace();
    void this.loadCustomerAddresses();
  }

  protected readonly vendor = computed(() => {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    return this.market.vendorBySlug(slug);
  });

  protected readonly storeProducts = computed(() => {
    const store = this.vendor();
    return store ? this.market.productsForVendor(store.id) : [];
  });

  protected storeUrl(): string {
    const slug = this.vendor()?.slug ?? '';
    if (typeof window === 'undefined') {
      return `/vendor/${slug}`;
    }
    return `${window.location.origin}/vendor/${slug}`;
  }

  protected qrUrl(): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(this.storeUrl())}`;
  }

  protected storeHeroBackground(store: Vendor): string | null {
    if (!store.bannerUrl) return null;
    return `linear-gradient(90deg, rgba(12, 28, 34, 0.88), rgba(12, 28, 34, 0.58)), url("${store.bannerUrl}")`;
  }

  protected daysLeft(): number {
    const store = this.vendor();
    return store ? this.daysUntilExpiry(store) : 0;
  }

  protected expiryLabel(): string {
    const store = this.vendor();
    return store ? this.unregisteredExpiry(store).toLocaleDateString() : '';
  }

  protected whatsappShare(): string {
    const store = this.vendor();
    const name = store?.name || 'this Urban Market JA store';
    return `https://wa.me/?text=${encodeURIComponent(`Check out ${name} on Urban Market JA: ${this.storeUrl()}`)}`;
  }

  protected facebookShare(): string {
    return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(this.storeUrl())}`;
  }

  protected socialLinks(store: Vendor): NonNullable<Vendor['socialLinks']> {
    return (store.socialLinks || []).filter((link) => link.url && link.status !== 'hidden');
  }

  protected socialIcon(platform: string): string {
    return {
      facebook: 'f',
      instagram: 'IG',
      whatsapp: 'WA',
      tiktok: 'TT',
      x: 'X',
      youtube: 'YT',
      website: 'www'
    }[platform] || 'link';
  }

  protected socialName(platform: string): string {
    return {
      facebook: 'Facebook',
      instagram: 'Instagram',
      whatsapp: 'WhatsApp',
      tiktok: 'TikTok',
      x: 'X',
      youtube: 'YouTube',
      website: 'Website'
    }[platform] || platform;
  }

  protected customerTrustLabel(store: Vendor): string {
    return store.registrationStatus === 'registered' ? 'Registered business' : 'Registration support';
  }

  protected storeAddressLabel(): string {
    const store = this.vendor();
    return [store?.addressLine1, store?.location, store?.parish, 'Jamaica'].filter(Boolean).join(', ') || 'Jamaica';
  }

  protected distanceLabel(): string {
    return formatDistance(distanceKm(resolveCoordinates(this.originLocation()), resolveCoordinates(this.storeLocation())));
  }

  protected distanceNote(): string {
    if (resolveCoordinates(this.originLocation()) && resolveCoordinates(this.storeLocation())) {
      return 'Approximate distance. Directions open in your maps app.';
    }
    if (!this.auth.isSignedIn()) {
      return 'Sign in with a saved address or use your current location to estimate distance.';
    }
    return 'Add coordinates to your address or use your current location for a better estimate.';
  }

  protected directionsUrl(): string {
    return mapsDirectionsUrl(this.storeLocation(), this.originLocation());
  }

  protected mapSearchUrl(): string {
    return mapsSearchUrl(this.storeLocation());
  }

  protected safeMapUrl(): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(mapsEmbedUrl(this.storeLocation()));
  }

  protected useCurrentLocation(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.locationMessage.set('Location is not available in this browser.');
      return;
    }

    this.locationMessage.set('Checking your current location...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.visitorLocation.set({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        this.locationMessage.set('Using your current location for the distance estimate.');
      },
      () => this.locationMessage.set('Location permission was not granted. Directions can still open using the store address.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }

  protected iconFor(category: string): string {
    return category === 'Food' ? 'Food' : category === 'Beauty' ? 'Beauty' : 'Goods';
  }

  protected async copyStoreLink(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(this.storeUrl());
      this.copyLabel.set('Copied');
      window.setTimeout(() => this.copyLabel.set('Copy link'), 1800);
    }
  }

  protected toggleShareDetails(): void {
    this.shareDetailsOpen.update((isOpen) => !isOpen);
  }

  protected toggleLocationDetails(): void {
    this.locationDetailsOpen.update((isOpen) => !isOpen);
  }

  private async loadCustomerAddresses(): Promise<void> {
    if (!this.auth.isSignedIn() || this.auth.currentUser()?.role !== 'customer') return;
    try {
      const response = await fetch(apiUrl('/api/customer/addresses'), { headers: this.auth.authHeaders() });
      if (response.ok) {
        this.customerAddresses.set(await response.json() as CustomerAddress[]);
      }
    } catch {
      this.locationMessage.set('Saved addresses could not be loaded for distance estimates.');
    }
  }

  private defaultAddress(): CustomerAddress | null {
    return this.customerAddresses().find((address) => address.isDefault) ?? this.customerAddresses()[0] ?? null;
  }

  private originLocation(): CustomerAddress | ({ latitude: number; longitude: number } & Partial<CustomerAddress>) | null {
    const current = this.visitorLocation();
    if (current) {
      return {
        latitude: current.lat,
        longitude: current.lng,
        label: 'Current location',
        addressLine1: 'Current location',
        isDefault: false
      };
    }
    return this.defaultAddress();
  }

  private storeLocation(): Vendor {
    const store = this.vendor();
    return store ?? {
      id: '',
      name: 'Urban Market JA store',
      slug: '',
      location: 'Jamaica',
      rating: 0,
      deliveryDays: [],
      summary: '',
      registrationStatus: 'unregistered',
      onboardedAt: new Date().toISOString(),
      subscriptionStatus: 'trial',
      subscriptionPlan: 'Starter vendor',
      categories: []
    };
  }

  private unregisteredExpiry(vendor: Vendor): Date {
    const expiry = new Date(vendor.onboardedAt);
    expiry.setFullYear(expiry.getFullYear() + 1);
    return expiry;
  }

  private daysUntilExpiry(vendor: Vendor): number {
    return Math.ceil((this.unregisteredExpiry(vendor).getTime() - Date.now()) / 86400000);
  }
}
