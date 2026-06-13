import { Injectable, signal } from '@angular/core';
import { apiUrl } from './api-url';
import {
  FoodOffering,
  JobListing,
  MarketService,
  Product,
  Vendor
} from './market-data';

@Injectable({ providedIn: 'root' })
export class MarketApiService {
  private readonly vendorsSignal = signal<Vendor[]>([]);
  private readonly productsSignal = signal<Product[]>([]);
  private readonly foodsSignal = signal<FoodOffering[]>([]);
  private readonly servicesSignal = signal<MarketService[]>([]);
  private readonly jobsSignal = signal<JobListing[]>([]);
  private readonly errorSignal = signal('');

  readonly vendors = this.vendorsSignal.asReadonly();
  readonly products = this.productsSignal.asReadonly();
  readonly foods = this.foodsSignal.asReadonly();
  readonly services = this.servicesSignal.asReadonly();
  readonly jobs = this.jobsSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  async loadMarketplace(): Promise<void> {
    try {
      const [apiVendors, apiProducts, apiFoods, apiServices] = await Promise.all([
        this.get<Vendor[]>('/api/vendors'),
        this.get<Product[]>('/api/products'),
        this.get<FoodOffering[]>('/api/foods'),
        this.get<MarketService[]>('/api/services')
      ]);
      const normalizedVendors = apiVendors.map((vendor) => this.normalizeVendor(vendor));
      this.vendorsSignal.set(normalizedVendors);
      this.productsSignal.set(this.enrichProducts(apiProducts.map((product) => this.normalizeProduct(product)), normalizedVendors));
      this.foodsSignal.set(this.enrichFoods(apiFoods, normalizedVendors));
      this.servicesSignal.set(apiServices.map((service) => this.normalizeService(service)));
      this.errorSignal.set('');
    } catch (error) {
      this.errorSignal.set(error instanceof Error ? error.message : 'Marketplace data could not be loaded.');
    }
  }

  async loadJobs(): Promise<void> {
    try {
      const apiJobs = await this.get<JobListing[]>('/api/jobs');
      this.jobsSignal.set(apiJobs.map((job) => this.normalizeJob(job)));
      this.errorSignal.set('');
    } catch (error) {
      this.errorSignal.set(error instanceof Error ? error.message : 'Jobs could not be loaded.');
    }
  }

  async loadService(id: string): Promise<MarketService | null> {
    try {
      const service = await this.get<MarketService>(`/api/services/${encodeURIComponent(id)}`);
      const normalized = this.normalizeService(service);
      this.servicesSignal.set(this.upsert(this.services(), normalized));
      this.errorSignal.set('');
      return normalized;
    } catch (error) {
      this.errorSignal.set(error instanceof Error ? error.message : 'Service could not be loaded.');
      return null;
    }
  }

  async loadProduct(id: string): Promise<Product | null> {
    try {
      const product = await this.get<Product>(`/api/products/${encodeURIComponent(id)}`);
      const normalized = this.normalizeProduct(product);
      this.productsSignal.set(this.upsert(this.products(), normalized));
      this.errorSignal.set('');
      return normalized;
    } catch (error) {
      this.errorSignal.set(error instanceof Error ? error.message : 'Product could not be loaded.');
      return null;
    }
  }

  async loadJob(id: string): Promise<JobListing | null> {
    try {
      const job = await this.get<JobListing>(`/api/jobs/${encodeURIComponent(id)}`);
      const normalized = this.normalizeJob(job);
      this.jobsSignal.set(this.upsert(this.jobs(), normalized));
      this.errorSignal.set('');
      return normalized;
    } catch (error) {
      this.errorSignal.set(error instanceof Error ? error.message : 'Job could not be loaded.');
      return null;
    }
  }

  vendorById(id: string): Vendor | undefined {
    return this.vendors().find((vendor) => vendor.id === id);
  }

  vendorBySlug(slug: string): Vendor | undefined {
    return this.vendors().find((vendor) => vendor.slug === slug);
  }

  productById(id: string): Product | undefined {
    return this.products().find((product) => product.id === id);
  }

  productsForVendor(vendorId: string): Product[] {
    return this.products().filter((product) => product.vendorId === vendorId);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(apiUrl(path));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `API request failed: ${path}`);
    }
    return payload as T;
  }

  private normalizeVendor(vendor: Vendor): Vendor {
    const normalizedMedia = (vendor.galleryMedia || [])
      .filter((media) => media?.url)
      .map((media) => ({
        ...media,
        url: this.mediaUrl(media.url),
        mediaType: media.mediaType,
        sortOrder: Number(media.sortOrder || 0)
      }))
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    const logoUrl = this.mediaUrl(vendor.logoUrl || '') || this.firstMediaUrl(normalizedMedia, 'logo');
    const bannerUrl = this.mediaUrl(vendor.bannerUrl || '') || this.firstMediaUrl(normalizedMedia, 'banner');

    return {
      ...vendor,
      slug: vendor.slug || this.slugFor(vendor.name),
      location: vendor.location || 'Jamaica',
      addressLine1: vendor.addressLine1 || vendor.location || '',
      addressLine2: vendor.addressLine2 || '',
      parish: vendor.parish || '',
      latitude: vendor.latitude === null || vendor.latitude === undefined || vendor.latitude === '' ? null : Number(vendor.latitude),
      longitude: vendor.longitude === null || vendor.longitude === undefined || vendor.longitude === '' ? null : Number(vendor.longitude),
      rating: Number(vendor.rating || 0),
      deliveryDays: vendor.deliveryDays?.length ? vendor.deliveryDays : ['Mon', 'Wed', 'Fri'],
      summary: vendor.summary || 'Urban Market JA vendor store.',
      registrationStatus: vendor.registrationStatus || 'unregistered',
      subscriptionStatus: vendor.subscriptionStatus || 'trial',
      subscriptionPlan: vendor.subscriptionPlan || 'Starter vendor',
      logoUrl,
      bannerUrl,
      galleryMedia: normalizedMedia.filter((media) => this.isGalleryMedia(media, logoUrl, bannerUrl)),
      socialLinks: (vendor.socialLinks || [])
        .filter((link) => link?.url && link.status !== 'hidden')
        .map((link) => ({ ...link, sortOrder: Number(link.sortOrder || 0) }))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
      themeKey: this.storeThemeKey(vendor.themeKey),
      themePrimaryColor: this.colorValue(vendor.themePrimaryColor),
      themeAccentColor: this.colorValue(vendor.themeAccentColor),
      themeBackgroundColor: this.colorValue(vendor.themeBackgroundColor),
      storeType: vendor.storeType || 'products',
      categories: vendor.categories?.length ? vendor.categories : ['Marketplace']
    };
  }

  private normalizeProduct(product: Product): Product {
    const price = Number(product.price || 0);
    const originalPrice = Number(product.originalPrice ?? price);
    const customizationTemplate = product.customizationTemplate ? this.normalizeCustomizationTemplate(product.customizationTemplate) : null;
    const productImages = (product.images || [])
      .filter((image) => image?.url)
      .map((image) => ({ ...image, url: this.mediaUrl(image.url), sortOrder: Number(image.sortOrder || 0) }))
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    const customizationImages = (customizationTemplate?.surfaces || [])
      .filter((surface) => surface.baseImageUrl)
      .map((surface, index) => ({
        id: `customization-surface-${surface.id || surface.surfaceKey || index}`,
        url: surface.baseImageUrl,
        altText: `${product.name} ${surface.name || 'customizer'} view`,
        sortOrder: 1000 + Number(surface.sortOrder || index)
      }));
    const seenImages = new Set<string>();
    const images = [...productImages, ...customizationImages]
      .filter((image) => {
        if (!image.url || seenImages.has(image.url)) return false;
        seenImages.add(image.url);
        return true;
      })
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    return {
      ...product,
      category: product.category || 'Products',
      price,
      originalPrice,
      hasDiscount: Boolean(product.hasDiscount) || originalPrice > price,
      discount: product.discount ?? null,
      isFeatured: Boolean(product.isFeatured),
      featuredUntil: product.featuredUntil ?? null,
      rating: Number(product.rating || 4.8),
      deliveryDay: product.deliveryDay || 'Available',
      description: product.description || 'Available from a local Urban Market JA vendor.',
      stockQuantity: Number(product.stockQuantity ?? 0),
      imageUrl: this.mediaUrl(product.imageUrl) || images[0]?.url || '',
      images,
      storeTheme: this.storeThemeKey(product.storeTheme),
      storeThemePrimaryColor: this.colorValue(product.storeThemePrimaryColor),
      storeThemeAccentColor: this.colorValue(product.storeThemeAccentColor),
      storeThemeBackgroundColor: this.colorValue(product.storeThemeBackgroundColor),
      isCustomizable: Boolean(product.isCustomizable || customizationTemplate?.fields?.length),
      customizationTemplate
    };
  }

  private normalizeCustomizationTemplate(template: NonNullable<Product['customizationTemplate']>): NonNullable<Product['customizationTemplate']> {
    return {
      ...template,
      surfaces: (template.surfaces || [])
        .map((surface) => ({
          ...surface,
          baseImageUrl: this.mediaUrl(surface.baseImageUrl),
          widthPx: surface.widthPx === null || surface.widthPx === undefined ? null : Number(surface.widthPx),
          heightPx: surface.heightPx === null || surface.heightPx === undefined ? null : Number(surface.heightPx),
          sortOrder: Number(surface.sortOrder || 0)
        }))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
      fields: (template.fields || [])
        .map((field) => ({
          ...field,
          isRequired: Boolean(field.isRequired),
          priceDeltaJmd: Number(field.priceDeltaJmd || 0),
          sortOrder: Number(field.sortOrder || 0),
          options: (field.options || [])
            .map((option) => ({
              ...option,
              priceDeltaJmd: Number(option.priceDeltaJmd || 0),
              sortOrder: Number(option.sortOrder || 0)
            }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
          placements: (field.placements || [])
            .map((placement) => ({
              ...placement,
              xPercent: Number(placement.xPercent ?? 50),
              yPercent: Number(placement.yPercent ?? 50),
              widthPercent: Number(placement.widthPercent ?? 30),
              heightPercent: Number(placement.heightPercent ?? 10),
              rotationDegrees: Number(placement.rotationDegrees || 0),
              fontSizePercent: placement.fontSizePercent === null || placement.fontSizePercent === undefined ? null : Number(placement.fontSizePercent),
              zIndex: Number(placement.zIndex || 1)
            }))
            .sort((a, b) => Number(a.zIndex || 1) - Number(b.zIndex || 1))
        }))
        .filter((field) => field.status !== 'hidden')
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    };
  }

  private normalizeService(service: MarketService): MarketService {
    return {
      ...service,
      rating: Number(service.rating || 4.8),
      price: Number(service.price || 0),
      pricingType: service.pricingType || 'Fixed',
      imageUrl: this.mediaUrl(service.imageUrl),
      reviews: service.reviews || [],
      details: service.details || service.description || 'Service details will be confirmed during booking.'
    };
  }

  private normalizeJob(job: JobListing): JobListing {
    const status = job.status || (job.isApproved ? 'published' : 'pending_approval');
    const salary = Number(job.salary || 0);
    const salaryMin = Number(job.salaryMin ?? salary);
    const salaryMax = Number(job.salaryMax ?? salaryMin);
    return {
      ...job,
      salary,
      salaryMin,
      salaryMax: Math.max(salaryMin, salaryMax),
      responsibilities: Array.isArray(job.responsibilities) ? job.responsibilities : [],
      requirements: Array.isArray(job.requirements) ? job.requirements : [],
      postedAt: job.postedAt || new Date().toISOString(),
      deadline: job.deadline || '',
      isApproved: job.isApproved || status === 'published' || status === 'Published',
      status
    };
  }

  private enrichProducts(items: Product[], vendorList: Vendor[]): Product[] {
    return items.flatMap((product) => {
      const vendor = vendorList.find((item) => item.id === product.vendorId);
      return vendor ? [{
        ...this.normalizeProduct(product),
        vendorName: product.vendorName || vendor.name,
        vendorSlug: product.vendorSlug || product.storeSlug || vendor.slug,
        storeSlug: product.storeSlug || vendor.slug,
        storeName: product.storeName || vendor.name,
        storeTheme: product.storeTheme || vendor.themeKey || 'street',
        storeThemePrimaryColor: product.storeThemePrimaryColor || vendor.themePrimaryColor || null,
        storeThemeAccentColor: product.storeThemeAccentColor || vendor.themeAccentColor || null,
        storeThemeBackgroundColor: product.storeThemeBackgroundColor || vendor.themeBackgroundColor || null
      }] : [];
    });
  }

  private enrichFoods(items: FoodOffering[], vendorList: Vendor[]): FoodOffering[] {
    return items.flatMap((food) => {
      const vendor = vendorList.find((item) => item.id === food.vendorId);
      if (!vendor) return [];
      const price = Number(food.price || 0);
      const originalPrice = Number(food.originalPrice ?? price);
      return [{
        ...food,
        price,
        originalPrice,
        hasDiscount: Boolean(food.hasDiscount) || originalPrice > price,
        discount: food.discount ?? null,
        description: food.description || 'Ready food from an Urban Market JA vendor.',
        imageUrl: this.mediaUrl(food.imageUrl),
        vendorName: vendor.name,
        vendorSlug: food.vendorSlug || vendor.slug,
        storeSlug: food.storeSlug || vendor.slug,
        storeName: food.storeName || vendor.name
      }];
    });
  }

  private upsert<T extends { id: string }>(items: T[], item: T): T[] {
    return items.some((existing) => existing.id === item.id)
      ? items.map((existing) => existing.id === item.id ? item : existing)
      : [...items, item];
  }

  private slugFor(value: string): string {
    return String(value || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `store-${Date.now()}`;
  }

  private storeThemeKey(value?: string): string {
    const theme = String(value || 'street').toLowerCase();
    return ['street', 'island', 'night', 'fresh'].includes(theme) ? theme : 'street';
  }

  private colorValue(value?: string | null): string | null {
    const text = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : null;
  }

  private firstMediaUrl(items: Array<{ url?: string; mediaType?: string; altText?: string }>, type: string): string {
    return items.find((media) => this.mediaKind(media) === type)?.url || '';
  }

  private isGalleryMedia(media: { url?: string; mediaType?: string; altText?: string }, logoUrl?: string | null, bannerUrl?: string | null): boolean {
    if (!media.url || media.url === logoUrl || media.url === bannerUrl) return false;
    return this.mediaKind(media) === 'gallery';
  }

  private mediaKind(media: { mediaType?: string; altText?: string }): string {
    const explicit = String(media.mediaType || '').trim().toLowerCase();
    if (explicit) return explicit;
    const altText = String(media.altText || '').toLowerCase();
    if (/\blogo\b/.test(altText)) return 'logo';
    if (/\bbanner\b|\bcover\b|\bhero\b/.test(altText)) return 'banner';
    return 'gallery';
  }

  private mediaUrl(value?: string): string {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(data:|blob:)/i.test(text)) return text;
    if (/^https?:\/\//i.test(text)) {
      try {
        const parsed = new URL(text);
        if (parsed.pathname.startsWith('/uploads/')) {
          return apiUrl(`/api${parsed.pathname}${parsed.search}`);
        }
      } catch {
        return text;
      }
      return text;
    }
    const path = text.startsWith('/api/')
      ? text
      : text.startsWith('/uploads/')
        ? `/api${text}`
        : text.startsWith('uploads/')
          ? `/api/${text}`
          : text;
    return path.startsWith('/api/') ? apiUrl(path) : path;
  }
}
