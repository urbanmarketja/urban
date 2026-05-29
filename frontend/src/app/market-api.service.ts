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
      storeType: vendor.storeType || 'products',
      categories: vendor.categories?.length ? vendor.categories : ['Marketplace']
    };
  }

  private normalizeProduct(product: Product): Product {
    const price = Number(product.price || 0);
    const originalPrice = Number(product.originalPrice ?? price);
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
      imageUrl: this.mediaUrl(product.imageUrl)
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
    return {
      ...job,
      salary: Number(job.salary || 0),
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
      return vendor ? [{ ...this.normalizeProduct(product), vendorName: vendor.name, vendorSlug: vendor.slug }] : [];
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
        vendorSlug: vendor.slug
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

  private mediaUrl(value?: string): string {
    if (!value) return '';
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    const path = value.startsWith('/api/')
      ? value
      : value.startsWith('uploads/')
        ? `/api/${value}`
        : value;
    return path.startsWith('/api/') ? apiUrl(path) : path;
  }
}
