import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { CartService } from './cart.service';
import { MarketApiService } from './market-api.service';
import { Product, ProductCustomizationField, ProductCustomizationOption, ProductCustomizationPlacement, ProductCustomizationSurface, ProductCustomizationTemplate, ProductImage, discountLabelFor, formatCurrency, hasDiscountPrice } from './market-data';

interface CustomerCustomizationImage {
  imageName?: string;
  imageMimeType?: string;
  imageSizeBytes?: number;
  imageDataBase64?: string;
  imageUrl?: string;
  url?: string;
}

@Component({
  selector: 'app-product-detail-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main [class]="productPageClass()" [style.--terracotta]="storeThemePrimaryColor()" [style.--terracotta-deep]="storeThemePrimaryColor()" [style.--ochre]="storeThemeAccentColor()" [style.--mustard]="storeThemeAccentColor()" [style.--store-hero-a]="storeThemeBackgroundColor()">
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
              @if (customizationTemplate()) {
                <div class="custom-price-preview">
                  <span>Customization add-ons</span>
                  <strong>{{ money(customizationAddOnTotal()) }}</strong>
                  <span>Total before quantity</span>
                  <strong>{{ money(customizedUnitPrice(item)) }}</strong>
                </div>
              }

              <div class="store-highlight-grid product-detail-facts">
                <div><strong>{{ item.deliveryDay }}</strong><span>Delivery or pickup</span></div>
                <div><strong>{{ stockLabel(item) }}</strong><span>Stock status</span></div>
              </div>

              <div class="product-detail-description">
                <h2>Description</h2>
                <p>{{ item.description }}</p>
              </div>

              @if (!customizationTemplate()) {
                <div class="share-actions">
                  <button class="button primary-button" type="button" (click)="cart.addProduct(item)">Add to cart</button>
                  <a class="button secondary-button" [routerLink]="['/vendor', storeSlug()]">Visit store</a>
                </div>
              } @else {
                <a class="button secondary-button" [routerLink]="['/vendor', storeSlug()]">Visit store</a>
              }
            </section>
          </div>

          @if (customizationTemplate(); as template) {
            <section class="product-customizer-panel">
              <div class="section-heading compact-heading">
                <h2>{{ template.title || 'Customize this item' }}</h2>
                <p>{{ template.instructions || 'Enter your customization details and confirm the preview before adding to cart.' }}</p>
              </div>

              <div class="product-customizer-grid">
                <div class="customer-preview-wrap">
                  @if ((customizationTemplate()?.surfaces?.length || 0) > 1) {
                    <div class="custom-surface-tabs customer-surface-tabs" role="tablist" aria-label="Product customization surfaces">
                      @for (surface of customizationTemplate()?.surfaces || []; track surface.id) {
                        <button class="button-sm light" type="button" [class.active]="surface.id === selectedCustomizationSurfaceId" (click)="selectCustomizationSurface(surface.id)">
                          {{ surface.name }}
                        </button>
                      }
                    </div>
                  }
                  <div class="custom-preview-canvas customer-preview-canvas">
                    @if (customizationSurface(); as surface) {
                      @if (surface.baseImageUrl) {
                        <img [src]="surface.baseImageUrl" [alt]="surface.name || item.name">
                      } @else {
                        <div class="custom-preview-empty">
                          <strong>{{ surface.name || 'Product preview' }}</strong>
                          <span>Preview image is being prepared by the store.</span>
                        </div>
                      }
                    }
                    @for (field of customizationFields(); track field.id) {
                      @if (placementFor(field); as placement) {
                        <div class="custom-preview-field customer-preview-field"
                          [style.left.%]="placement.xPercent"
                          [style.top.%]="placement.yPercent"
                          [style.width.%]="placement.widthPercent"
                          [style.height.%]="placement.heightPercent"
                          [style.transform]="customizationFieldTransform(placement)"
                          [style.background]="placement.backgroundColor || 'transparent'"
                          [style.z-index]="placement.zIndex || 1">
                          @if (field.fieldType === 'image' && imagePreviewUrl(field)) {
                            <img class="custom-preview-upload-image" [src]="imagePreviewUrl(field)" [alt]="field.label + ' preview'" loading="lazy" decoding="async">
                          } @else {
                            <span class="custom-preview-value"
                              [style.font-family]="customizationFieldFontFamily(placement)"
                              [style.font-size.px]="customizationFieldFontSize(placement)"
                              [style.font-weight]="placement.fontWeight || '700'"
                              [style.text-align]="placement.textAlign || 'center'"
                              [style.color]="placement.textColor || '#132f3a'">{{ previewValue(field) }}</span>
                          }
                        </div>
                      }
                    }
                  </div>
                  <p class="product-meta">This preview uses the layout saved by the store.</p>
                  @if (printAreaWarnings().length) {
                    <div class="notice print-warning">
                      @for (warning of printAreaWarnings(); track warning) {
                        <p>{{ warning }}</p>
                      }
                    </div>
                  }
                </div>

                <form class="profile-form customer-customization-form" (ngSubmit)="addCustomizedToCart(item)">
                  @for (field of customizationFields(); track field.id) {
                    <label>
                      {{ field.label }} @if (field.isRequired) { <span class="required-marker">*</span> }
                      @if (field.fieldType === 'number') {
                        <input type="number" [name]="'custom' + field.id" [(ngModel)]="customizationValues[field.fieldKey]" (ngModelChange)="customizationChanged()" [required]="!!field.isRequired" [attr.min]="field.minValue ?? null" [attr.max]="field.maxValue ?? null" [placeholder]="field.placeholder || field.label">
                      } @else if (field.fieldType === 'color') {
                        <input type="color" [name]="'custom' + field.id" [(ngModel)]="customizationValues[field.fieldKey]" (ngModelChange)="customizationChanged()" [required]="!!field.isRequired">
                      } @else if (field.fieldType === 'select') {
                        <select [name]="'custom' + field.id" [(ngModel)]="customizationValues[field.fieldKey]" (ngModelChange)="customizationChanged()" [required]="!!field.isRequired">
                          @for (option of activeOptions(field); track option.optionValue) {
                            <option [value]="option.optionValue">{{ optionLabel(option) }}</option>
                          }
                        </select>
                      } @else if (field.fieldType === 'checkbox') {
                        <span class="checkbox-line customer-checkbox">
                          <input type="checkbox" [name]="'custom' + field.id" [(ngModel)]="customizationValues[field.fieldKey]" (ngModelChange)="customizationChanged()" [required]="!!field.isRequired">
                          {{ checkboxLabel(field) }}
                        </span>
                      } @else if (field.fieldType === 'image') {
                        <div class="custom-image-control">
                          <input class="custom-image-input" type="file" [name]="'custom' + field.id" accept="image/*,.heic,.heif,image/heic,image/heif" [required]="field.isRequired && !imagePreviewUrl(field)" (change)="selectCustomizationImage($event, field)">
                          @if (imagePreviewUrl(field)) {
                            <div class="custom-image-preview">
                              <img [src]="imagePreviewUrl(field)" [alt]="field.label + ' uploaded image'" loading="lazy" decoding="async">
                              <div>
                                <strong>{{ imageFileName(field) }}</strong>
                                <span>{{ imageFileSize(field) }}</span>
                              </div>
                              <button class="button-sm light" type="button" (click)="clearCustomizationImage(field)">Remove</button>
                            </div>
                          }
                        </div>
                      } @else {
                        <input [name]="'custom' + field.id" [(ngModel)]="customizationValues[field.fieldKey]" (ngModelChange)="customizationChanged()" [required]="!!field.isRequired" [attr.minlength]="field.minLength ?? null" [attr.maxlength]="field.maxLength || 120" [placeholder]="field.placeholder || field.label">
                      }
                      @if (field.helpText) {
                        <span class="product-meta">{{ field.helpText }}</span>
                      }
                    </label>
                  }

                  <label class="checkbox-line customer-confirmation">
                    <input type="checkbox" name="customizationConfirmed" [(ngModel)]="customizationConfirmed">
                    I confirm these customization details are correct.
                  </label>

                  @if (customizationMessage()) {
                    <div class="notice" [class.error]="customizationMessageIsError()">{{ customizationMessage() }}</div>
                  }

                  @if (customizationAddOns().length) {
                    <div class="custom-addon-summary">
                      @for (addon of customizationAddOns(); track addon.label) {
                        <div><span>{{ addon.label }}</span><strong>{{ money(addon.amount) }}</strong></div>
                      }
                      <div class="custom-addon-total"><span>Customization total</span><strong>{{ money(customizationAddOnTotal()) }}</strong></div>
                    </div>
                  }

                  <button class="button primary-button" type="submit" [disabled]="customizationSubmitting">
                    {{ customizationSubmitting ? 'Checking preview...' : customizationSubmitLabel() }}
                  </button>
                </form>
              </div>
            </section>
          }
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
  protected customizationValues: Record<string, unknown> = {};
  protected customizationConfirmed = false;
  protected customizationSubmitting = false;
  protected readonly customizationMessage = signal('');
  protected readonly customizationMessageIsError = signal(false);
  protected selectedCustomizationSurfaceId = '';
  private readonly customizationImageMaxBytes = 8 * 1024 * 1024;
  private readonly customizationImageTypes = ['image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/webp'];
  private readonly customizationImageExtensions = ['.heic', '.heif', '.jpeg', '.jpg', '.png', '.webp'];
  private readonly loadedWebFonts = new Set<string>();
  private editingCartSignature = '';

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
    this.editingCartSignature = this.route.snapshot.queryParamMap.get('editCart') || '';
    void this.loadProduct();
  }

  protected storeSlug(): string {
    const item = this.product();
    return item?.storeSlug || item?.vendorSlug || this.route.snapshot.paramMap.get('slug') || '';
  }

  protected productPageClass(): string {
    const item = this.product();
    const storeTheme = item?.storeTheme || this.market.vendorById(item?.vendorId || '')?.themeKey || 'street';
    return `store-theme-${storeTheme}`;
  }

  protected storeThemePrimaryColor(): string | null {
    const item = this.product();
    return item?.storeThemePrimaryColor || this.market.vendorById(item?.vendorId || '')?.themePrimaryColor || null;
  }

  protected storeThemeAccentColor(): string | null {
    const item = this.product();
    return item?.storeThemeAccentColor || this.market.vendorById(item?.vendorId || '')?.themeAccentColor || null;
  }

  protected storeThemeBackgroundColor(): string | null {
    const item = this.product();
    return item?.storeThemeBackgroundColor || this.market.vendorById(item?.vendorId || '')?.themeBackgroundColor || null;
  }

  protected stockLabel(item: Product): string {
    const stock = Number(item.stockQuantity || 0);
    return stock > 0 ? `${stock} available` : 'Ask store';
  }

  protected labelFor(category: string): string {
    return category === 'Food' ? 'Food' : category === 'Beauty' ? 'Beauty' : 'Goods';
  }

  protected customizationTemplate(): ProductCustomizationTemplate | null {
    return this.product()?.customizationTemplate || null;
  }

  protected customizationSurface(): ProductCustomizationSurface | null {
    const surfaces = this.customizationTemplate()?.surfaces || [];
    return surfaces.find((surface) => surface.id === this.selectedCustomizationSurfaceId) || surfaces[0] || null;
  }

  protected customizationFields(): ProductCustomizationField[] {
    return (this.customizationTemplate()?.fields || [])
      .filter((field) => field.status !== 'hidden');
  }

  protected activeOptions(field: ProductCustomizationField): NonNullable<ProductCustomizationField['options']> {
    return (field.options || []).filter((option) => option.status !== 'hidden');
  }

  protected placementFor(field: ProductCustomizationField): ProductCustomizationPlacement | null {
    const surfaceId = this.customizationSurface()?.id;
    return (field.placements || []).find((placement) => placement.surfaceId === surfaceId) || null;
  }

  protected selectCustomizationSurface(surfaceId: string): void {
    this.selectedCustomizationSurfaceId = surfaceId;
  }

  protected previewValue(field: ProductCustomizationField): string {
    const value = this.customizationValues[field.fieldKey];
    if (field.fieldType === 'checkbox') {
      return value ? field.label : `${field.label}: no`;
    }
    if (field.fieldType === 'select') {
      const option = this.activeOptions(field).find((item) => item.optionValue === value || item.label === value);
      return option?.label || String(value || field.label);
    }
    if (field.fieldType === 'color') {
      return String(value || field.defaultValue || '#ff7a00');
    }
    if (field.fieldType === 'image') {
      const image = this.customizationImageValue(field);
      return image?.imageName || image?.url || image?.imageUrl || field.placeholder || 'Uploaded image';
    }
    return String(value || field.defaultValue || field.placeholder || field.label);
  }

  protected imagePreviewUrl(field: ProductCustomizationField): string {
    const image = this.customizationImageValue(field);
    if (!image) return '';
    if (image.imageDataBase64) {
      return `data:${image.imageMimeType || 'image/jpeg'};base64,${image.imageDataBase64}`;
    }
    return this.mediaUrl(image.imageUrl || image.url || '');
  }

  protected imageFileName(field: ProductCustomizationField): string {
    const image = this.customizationImageValue(field);
    return image?.imageName || image?.url?.split('/').pop() || image?.imageUrl?.split('/').pop() || 'Selected image';
  }

  protected imageFileSize(field: ProductCustomizationField): string {
    const size = Number(this.customizationImageValue(field)?.imageSizeBytes || 0);
    if (!size) return 'Saved image';
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  protected clearCustomizationImage(field: ProductCustomizationField): void {
    this.customizationValues[field.fieldKey] = '';
    this.customizationConfirmed = false;
  }

  protected async selectCustomizationImage(event: Event, field: ProductCustomizationField): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.customizationValues[field.fieldKey] = '';
    this.customizationConfirmed = false;
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!this.customizationImageTypes.includes(file.type) && !this.customizationImageExtensions.some((extension) => lowerName.endsWith(extension))) {
      this.setCustomizationMessage('Upload a JPG, PNG, WEBP, HEIC, or HEIF image.', true);
      input.value = '';
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.setCustomizationMessage('Choose an image smaller than 20 MB.', true);
      input.value = '';
      return;
    }

    try {
      const image = await this.readOptimizedImageFile(file, 1600);
      if (Number(image.imageSizeBytes || 0) > this.customizationImageMaxBytes) {
        this.setCustomizationMessage('Customization image must be 8 MB or smaller after compression.', true);
        input.value = '';
        return;
      }
      this.customizationValues[field.fieldKey] = {
        imageName: file.name,
        ...image
      } satisfies CustomerCustomizationImage;
      this.setCustomizationMessage('', false);
    } catch {
      this.setCustomizationMessage('Image could not be read. Try selecting it again.', true);
      input.value = '';
    }
  }

  protected customizationChanged(): void {
    this.customizationConfirmed = false;
  }

  protected printAreaWarnings(): string[] {
    return this.customizationFields()
      .map((field) => {
        const placement = this.placementFor(field);
        if (!placement) return '';
        const x = Number(placement.xPercent || 0);
        const y = Number(placement.yPercent || 0);
        const width = Number(placement.widthPercent || 0);
        const height = Number(placement.heightPercent || 0);
        const left = x - width / 2;
        const right = x + width / 2;
        const top = y - height / 2;
        const bottom = y + height / 2;
        return left < 4 || right > 96 || top < 4 || bottom > 96
          ? `${field.label} is close to the edge of the print area.`
          : '';
      })
      .filter(Boolean)
      .slice(0, 3);
  }

  protected customizationFieldTransform(placement: ProductCustomizationPlacement): string {
    return `translate(-50%, -50%) rotate(${Number(placement.rotationDegrees || 0)}deg)`;
  }

  protected customizationFieldFontSize(placement: ProductCustomizationPlacement): number {
    return Math.max(11, Math.min(40, Number(placement.fontSizePercent || 14) * 1.2));
  }

  protected customizationFieldFontFamily(placement: ProductCustomizationPlacement): string {
    const fontFamily = placement.fontFamily || 'Arial, Helvetica, sans-serif';
    this.ensureWebFont(fontFamily);
    return fontFamily;
  }

  protected customizationSubmitLabel(): string {
    return this.editingCartSignature ? 'Update customized item in cart' : 'Add customized item to cart';
  }

  protected optionLabel(option: ProductCustomizationOption): string {
    const amount = Number(option.priceDeltaJmd || 0);
    return amount > 0 ? `${option.label} (+${this.money(amount)})` : option.label;
  }

  protected checkboxLabel(field: ProductCustomizationField): string {
    const label = field.placeholder || 'Yes, include this option';
    const amount = Number(field.priceDeltaJmd || 0);
    return amount > 0 ? `${label} (+${this.money(amount)})` : label;
  }

  protected customizationAddOns(): Array<{ label: string; amount: number }> {
    return this.customizationFields()
      .map((field) => this.customizationAddOnForField(field))
      .filter((item): item is { label: string; amount: number } => Boolean(item && item.amount > 0));
  }

  protected customizationAddOnTotal(): number {
    return this.customizationAddOns().reduce((sum, addon) => sum + addon.amount, 0);
  }

  protected customizedUnitPrice(item: Product): number {
    return Number(item.price || 0) + this.customizationAddOnTotal();
  }

  protected async addCustomizedToCart(item: Product): Promise<void> {
    const template = this.customizationTemplate();
    if (!template) {
      await this.cart.addProduct(item);
      return;
    }
    if (!this.validateCustomizationFields()) {
      return;
    }
    if (!this.customizationConfirmed) {
      this.setCustomizationMessage('Confirm the customization preview before adding this item to cart.', true);
      return;
    }
    this.customizationSubmitting = true;
    this.setCustomizationMessage('', false);
    try {
      const body = {
        customizations: this.customizationValues,
        previews: this.customizationPreviewPayload()
      };
      const response = await fetch(apiUrl(`/api/products/${encodeURIComponent(item.id)}/customizations/validate`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const validation = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(validation.error || 'Customization could not be validated.');
      }
      const wasEditing = Boolean(this.editingCartSignature);
      const editingQty = wasEditing ? Math.max(1, Number(this.editingCartItem(item)?.qty || 1)) : 1;
      if (wasEditing) {
        await this.cart.remove(item.id, this.editingCartSignature);
      }
      await this.cart.addProduct(item, {
        customizations: validation.customizations || body.customizations,
        previews: validation.previews || body.previews,
        validation
      });
      if (wasEditing && editingQty > 1) {
        await this.cart.updateQty(item.id, editingQty, validation.customizationSignature || '');
      }
      this.editingCartSignature = validation.customizationSignature || '';
      this.setCustomizationMessage(wasEditing ? 'Customized item updated in cart.' : 'Customized item added to cart.', false);
      this.customizationConfirmed = false;
    } catch (error) {
      this.setCustomizationMessage(error instanceof Error ? error.message : 'Customization could not be added to cart.', true);
    } finally {
      this.customizationSubmitting = false;
    }
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
    this.selectedCustomizationSurfaceId = item.customizationTemplate?.surfaces?.[0]?.id || '';
    this.initializeCustomizationValues(item.customizationTemplate || null);
    this.applyCartEditValues(item);
  }

  private initializeCustomizationValues(template: ProductCustomizationTemplate | null): void {
    this.customizationValues = {};
    this.customizationConfirmed = false;
    this.setCustomizationMessage('', false);
    for (const field of template?.fields || []) {
      if (field.status === 'hidden') continue;
      if (field.fieldType === 'select') {
        const options = this.activeOptions(field);
        const defaultOption = options.find((option) => option.optionValue === field.defaultValue || option.label === field.defaultValue);
        this.customizationValues[field.fieldKey] = defaultOption?.optionValue || options[0]?.optionValue || '';
      } else if (field.fieldType === 'checkbox') {
        const defaultValue = String(field.defaultValue || '').toLowerCase();
        this.customizationValues[field.fieldKey] = defaultValue === 'true' || defaultValue === '1' || defaultValue === 'yes';
      } else if (field.fieldType === 'color') {
        this.customizationValues[field.fieldKey] = field.defaultValue || '#ff7a00';
      } else if (field.fieldType === 'image') {
        this.customizationValues[field.fieldKey] = '';
      } else {
        this.customizationValues[field.fieldKey] = field.defaultValue || '';
      }
    }
  }

  private customizationAddOnForField(field: ProductCustomizationField): { label: string; amount: number } | null {
    const value = this.customizationValues[field.fieldKey];
    if (field.fieldType === 'checkbox') {
      const checked = value === true || value === 'true' || value === '1' || value === 1 || value === 'yes';
      return checked ? this.addOnLine(field.label, field.priceDeltaJmd) : null;
    }
    if (this.isCustomizationValueEmpty(value)) return null;
    if (field.fieldType === 'select') {
      const option = this.activeOptions(field).find((item) => item.optionValue === value || item.label === value);
      const fieldAmount = Number(field.priceDeltaJmd || 0);
      const optionAmount = Number(option?.priceDeltaJmd || 0);
      const amount = fieldAmount + optionAmount;
      return amount > 0 ? { label: `${field.label}: ${option?.label || value}`, amount } : null;
    }
    return this.addOnLine(field.label, field.priceDeltaJmd);
  }

  private addOnLine(label: string, amount: unknown): { label: string; amount: number } | null {
    const normalized = Number(amount || 0);
    return normalized > 0 ? { label, amount: normalized } : null;
  }

  private isCustomizationValueEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === '';
  }

  private validateCustomizationFields(): boolean {
    for (const field of this.customizationFields()) {
      const value = this.customizationValues[field.fieldKey];
      if (field.fieldType === 'image') {
        if (field.isRequired && !this.imagePreviewUrl(field)) {
          this.setCustomizationMessage(`${field.label} image is required.`, true);
          return false;
        }
        continue;
      }
      if (field.fieldType === 'checkbox') {
        const checked = value === true || value === 'true' || value === '1' || value === 1 || value === 'yes';
        if (field.isRequired && !checked) {
          this.setCustomizationMessage(`${field.label} must be selected.`, true);
          return false;
        }
        continue;
      }
      const text = String(value ?? '').trim();
      if (field.isRequired && !text) {
        this.setCustomizationMessage(`${field.label} is required.`, true);
        return false;
      }
      if (field.fieldType === 'text') {
        if (field.minLength !== null && field.minLength !== undefined && text.length < Number(field.minLength)) {
          this.setCustomizationMessage(`${field.label} must be at least ${field.minLength} characters.`, true);
          return false;
        }
        const maxLength = Number(field.maxLength || 120);
        if (text.length > maxLength) {
          this.setCustomizationMessage(`${field.label} must be ${maxLength} characters or fewer.`, true);
          return false;
        }
      }
      if (field.fieldType === 'number' && text) {
        const number = Number(text);
        if (!Number.isFinite(number)) {
          this.setCustomizationMessage(`${field.label} must be a number.`, true);
          return false;
        }
        if (field.minValue !== null && field.minValue !== undefined && number < Number(field.minValue)) {
          this.setCustomizationMessage(`${field.label} must be at least ${field.minValue}.`, true);
          return false;
        }
        if (field.maxValue !== null && field.maxValue !== undefined && number > Number(field.maxValue)) {
          this.setCustomizationMessage(`${field.label} must be no more than ${field.maxValue}.`, true);
          return false;
        }
      }
    }
    return true;
  }

  private customizationPreviewPayload(): unknown[] {
    const template = this.customizationTemplate();
    if (!template?.surfaces?.length) return [];
    return template.surfaces.map((surface) => ({
      surfaceKey: surface.surfaceKey || 'front',
      previewImageUrl: surface.baseImageUrl || null,
      previewJson: {
        surfaceId: surface.id,
        surfaceKey: surface.surfaceKey || 'front',
        baseImageUrl: surface.baseImageUrl || null,
        surfaceName: surface.name || null,
        templateId: this.customizationTemplate()?.id || null,
        values: this.sanitizedCustomizationValues(),
        fields: this.customizationFields().map((field) => ({
          fieldKey: field.fieldKey,
          fieldType: field.fieldType,
          label: field.label,
          value: this.previewValue(field),
          imageUrl: this.previewPayloadImageUrl(field),
          imageName: field.fieldType === 'image' ? this.imageFileName(field) : null,
          placement: (field.placements || []).find((placement) => placement.surfaceId === surface.id) || null
        })).filter((field) => Boolean(field.placement))
      }
    }));
  }

  private editingCartItem(item: Product): any | null {
    if (!this.editingCartSignature) return null;
    return this.cart.items().find((cartItem) => cartItem.productId === item.id && (cartItem.customizationSignature || '') === this.editingCartSignature) || null;
  }

  private applyCartEditValues(item: Product): void {
    const cartItem = this.editingCartItem(item);
    const customizations = Array.isArray(cartItem?.customizations) ? cartItem.customizations : [];
    if (!customizations.length) return;
    for (const row of customizations) {
      if (!row?.fieldKey) continue;
      this.customizationValues[row.fieldKey] = this.cartCustomizationValue(row);
    }
    this.setCustomizationMessage('Editing the customization already in your cart.', false);
  }

  private cartCustomizationValue(row: any): unknown {
    if (row.fieldType === 'checkbox') {
      return row.valueJson?.checked ?? row.valueText === 'Yes';
    }
    if (row.fieldType === 'select') {
      return row.valueJson?.optionValue || row.valueText || '';
    }
    if (row.fieldType === 'number') {
      return row.valueJson?.value ?? row.valueText ?? '';
    }
    if (row.fieldType === 'image') {
      return row.valueJson || (row.valueText ? { imageName: row.valueText, url: row.valueText } : '');
    }
    return row.valueText ?? '';
  }

  private customizationImageValue(field: ProductCustomizationField): CustomerCustomizationImage | null {
    const value = this.customizationValues[field.fieldKey];
    if (!value) return null;
    if (typeof value === 'string') {
      return value.trim() ? { imageName: value.trim().split('/').pop(), url: value.trim() } : null;
    }
    if (typeof value !== 'object') return null;
    return value as CustomerCustomizationImage;
  }

  private previewPayloadImageUrl(field: ProductCustomizationField): string | null {
    if (field.fieldType !== 'image') return null;
    const image = this.customizationImageValue(field);
    if (!image || image.imageDataBase64) return null;
    return image.imageUrl || image.url || null;
  }

  private sanitizedCustomizationValues(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.customizationValues)) {
      if (value && typeof value === 'object') {
        const { imageDataBase64, ...rest } = value as CustomerCustomizationImage;
        values[key] = rest;
      } else {
        values[key] = value;
      }
    }
    return values;
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

  private primaryFontName(value: string): string {
    return String(value || '')
      .split(',')[0]
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  private ensureWebFont(value: string): void {
    if (typeof document === 'undefined') return;
    const primary = this.primaryFontName(value);
    if (!primary || this.loadedWebFonts.has(primary)) return;
    const webSafeFonts = new Set(['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Times', 'Courier New', 'Courier', 'Impact', 'Haettenschweiler', 'Trebuchet MS', 'Verdana', 'Tahoma', 'serif', 'sans-serif', 'monospace', 'cursive']);
    if (webSafeFonts.has(primary)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(primary).replace(/%20/g, '+')}:wght@400;600;700;800&display=swap`;
    document.head.appendChild(link);
    this.loadedWebFonts.add(primary);
  }

  private async readOptimizedImageFile(file: File, maxDimension: number): Promise<CustomerCustomizationImage> {
    const originalDataUrl = await this.fileToDataUrl(file);
    const original = {
      imageMimeType: file.type || this.mimeTypeFromFileName(file.name),
      imageSizeBytes: file.size,
      imageDataBase64: this.base64FromDataUrl(originalDataUrl)
    };
    const compressed = await this.compressImageDataUrl(originalDataUrl, original.imageMimeType, maxDimension);
    return compressed && Number(compressed.imageSizeBytes || 0) < file.size ? compressed : original;
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Image could not be read'));
      reader.readAsDataURL(file);
    });
  }

  private compressImageDataUrl(dataUrl: string, mimeType: string, maxDimension: number): Promise<CustomerCustomizationImage | null> {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
    if (mimeType === 'image/heic' || mimeType === 'image/heif') return Promise.resolve(null);

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const compressedDataUrl = String(reader.result || '');
            resolve({
              imageMimeType: blob.type || 'image/webp',
              imageSizeBytes: blob.size,
              imageDataBase64: this.base64FromDataUrl(compressedDataUrl)
            });
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        }, 'image/webp', 0.86);
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  private base64FromDataUrl(value: string): string {
    return value.includes(',') ? value.split(',')[1] : value;
  }

  private mimeTypeFromFileName(name: string): string {
    const extension = name.toLowerCase().split('.').pop();
    return {
      heic: 'image/heic',
      heif: 'image/heif',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp'
    }[extension || ''] || 'application/octet-stream';
  }

  private setCustomizationMessage(message: string, isError: boolean): void {
    this.customizationMessage.set(message);
    this.customizationMessageIsError.set(isError);
  }
}
