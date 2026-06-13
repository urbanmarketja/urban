const config = require('../config');
const { buildOrderCheckout, buildServiceCheckout, buildSubscriptionCheckout } = require('../payments');
const { query, transaction } = require('../db/mysql');
const { createHash, randomUUID } = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const COIN_JMD_RATE = 1;
const FEATURE_PRODUCT_COST_COINS = 1500;
const FEATURE_PRODUCT_DAYS = 7;
const LARGE_HELD_BALANCE_CREDITS = 10000;
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MAX_VENDOR_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_LISTING_IMAGE_BYTES = 8 * 1024 * 1024;
const RESUME_UPLOAD_DIR = config.uploadDir || path.join(__dirname, '..', 'uploads', 'resumes');
const VENDOR_DOCUMENT_UPLOAD_DIR = path.join(path.dirname(RESUME_UPLOAD_DIR), 'vendor-documents');
const LISTING_MEDIA_UPLOAD_DIR = path.join(path.dirname(RESUME_UPLOAD_DIR), 'listing-media');
const CUSTOMIZATION_MEDIA_UPLOAD_DIR = path.join(path.dirname(RESUME_UPLOAD_DIR), 'customization-media');
const VENDOR_DOCUMENT_TYPES = new Map([
  ['application/pdf', ['.pdf']],
  ['image/heic', ['.heic']],
  ['image/heif', ['.heif']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/webp', ['.webp']],
  ['application/msword', ['.doc']],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['.docx']]
]);
const LISTING_IMAGE_TYPES = new Map([
  ['image/heic', ['.heic']],
  ['image/heif', ['.heif']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/webp', ['.webp']]
]);
const STORE_SOCIAL_PLATFORMS = new Set(['facebook', 'instagram', 'whatsapp', 'tiktok', 'x', 'youtube', 'website']);
const CUSTOMIZATION_FIELD_TYPES = new Set(['text', 'number', 'color', 'select', 'checkbox', 'image']);
const CUSTOMIZATION_TEMPLATE_STATUSES = new Set(['draft', 'active', 'paused']);
const CUSTOMIZATION_FIELD_STATUSES = new Set(['active', 'hidden']);
const CUSTOMIZATION_TEXT_ALIGNMENTS = new Set(['left', 'center', 'right']);

function latestVendorSubscriptionJoin(alias = 'sub') {
  return `
    LEFT JOIN (
      SELECT vs.*
      FROM vendor_subscriptions vs
      INNER JOIN (
        SELECT vendor_id, MAX(created_at) AS max_created_at
        FROM vendor_subscriptions
        GROUP BY vendor_id
      ) latest ON latest.vendor_id = vs.vendor_id AND latest.max_created_at = vs.created_at
    ) ${alias} ON ${alias}.vendor_id = v.id
  `;
}

function publicVendorSubscriptionJoin(subAlias = 'public_sub', planAlias = 'public_plan') {
  return `
    JOIN (
      SELECT vs.*
      FROM vendor_subscriptions vs
      INNER JOIN (
        SELECT vendor_id, MAX(created_at) AS max_created_at
        FROM vendor_subscriptions
        GROUP BY vendor_id
      ) latest ON latest.vendor_id = vs.vendor_id AND latest.max_created_at = vs.created_at
    ) ${subAlias} ON ${subAlias}.vendor_id = v.id AND ${subAlias}.status = 'active'
    JOIN subscription_plans ${planAlias} ON ${planAlias}.id = ${subAlias}.plan_id AND ${planAlias}.code <> 'starter'
  `;
}

function primaryProductImageJoin(alias = 'product_image') {
  return `
    LEFT JOIN (
      SELECT
        product_id AS productId,
        SUBSTRING_INDEX(GROUP_CONCAT(url ORDER BY sort_order, created_at SEPARATOR '||'), '||', 1) AS imageUrl
      FROM product_images
      GROUP BY product_id
    ) ${alias} ON ${alias}.productId = p.id
  `;
}

function productImageGalleryJoin(alias = 'product_gallery') {
  return `
    LEFT JOIN (
      SELECT
        product_id AS productId,
        JSON_ARRAYAGG(JSON_OBJECT(
          'id', id,
          'url', url,
          'altText', alt_text,
          'sortOrder', sort_order
        )) AS images
      FROM product_images
      GROUP BY product_id
    ) ${alias} ON ${alias}.productId = p.id
  `;
}

function primaryProductCustomizationImageJoin(alias = 'customization_image', activeOnly = true) {
  return `
    LEFT JOIN (
      SELECT
        t.product_id AS productId,
        SUBSTRING_INDEX(GROUP_CONCAT(s.base_image_url ORDER BY s.sort_order, s.created_at SEPARATOR '||'), '||', 1) AS imageUrl
      FROM product_customization_templates t
      JOIN product_customization_surfaces s ON s.template_id = t.id
      WHERE s.base_image_url IS NOT NULL
        AND s.base_image_url <> ''
        ${activeOnly ? "AND t.status = 'active'" : ''}
      GROUP BY t.product_id
    ) ${alias} ON ${alias}.productId = p.id
  `;
}

function primaryServiceImageJoin(alias = 'service_image') {
  return `
    LEFT JOIN (
      SELECT
        service_id AS serviceId,
        SUBSTRING_INDEX(GROUP_CONCAT(url ORDER BY sort_order, created_at SEPARATOR '||'), '||', 1) AS imageUrl
      FROM service_images
      GROUP BY service_id
    ) ${alias} ON ${alias}.serviceId = s.id
  `;
}

function primaryStoreMediaJoin(alias = 'store_media_primary') {
  return `
    LEFT JOIN (
      SELECT
        store_id AS storeId,
        SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN media_type = 'logo' THEN url END ORDER BY sort_order, created_at SEPARATOR '||'), '||', 1) AS logoUrl,
        SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN media_type = 'banner' THEN url END ORDER BY sort_order, created_at SEPARATOR '||'), '||', 1) AS bannerUrl
      FROM store_media
      GROUP BY store_id
    ) ${alias} ON ${alias}.storeId = st.id
  `;
}

function activeStoreSocialLinksJoin(alias = 'store_social_active') {
  return `
    LEFT JOIN (
      SELECT
        store_id AS storeId,
        JSON_ARRAYAGG(JSON_OBJECT(
          'id', id,
          'platform', platform,
          'label', label,
          'url', url,
          'status', status,
          'sortOrder', sort_order
        )) AS socialLinks
      FROM store_social_links
      WHERE status = 'active'
      GROUP BY store_id
    ) ${alias} ON ${alias}.storeId = st.id
  `;
}

function storeGalleryMediaJoin(alias = 'store_gallery_media') {
  return `
    LEFT JOIN (
      SELECT
        store_id AS storeId,
        JSON_ARRAYAGG(JSON_OBJECT(
          'id', id,
          'url', url,
          'altText', alt_text,
          'sortOrder', sort_order
        )) AS galleryMedia
      FROM store_media
      WHERE media_type = 'gallery'
      GROUP BY store_id
    ) ${alias} ON ${alias}.storeId = st.id
  `;
}

function isDatabaseEnabled() {
  return config.useDatabase;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

function asJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function safeParseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function unregisteredExpiry(vendor) {
  const expiry = new Date(vendor.onboardedAt);
  expiry.setFullYear(expiry.getFullYear() + 1);
  return expiry;
}

function daysUntilExpiry(vendor) {
  return Math.ceil((unregisteredExpiry(vendor).getTime() - Date.now()) / 86400000);
}

function isStarterPlan(vendor) {
  const plan = String(vendor?.subscriptionPlanCode || vendor?.subscriptionPlan || '').toLowerCase();
  return plan === 'starter' || plan.includes('starter');
}

function complianceAlertFor(vendor) {
  const isRegistered = vendor.registrationStatus === 'registered';
  const hasActiveSubscription = vendor.subscriptionStatus === 'active';
  const hasPublicPlan = !isStarterPlan(vendor);
  const daysRemaining = isRegistered ? null : daysUntilExpiry(vendor);
  const canPublishProducts = hasActiveSubscription && isRegistered && hasPublicPlan;
  let severity = 'ok';
  let message = 'Vendor is compliant.';

  if (vendor.subscriptionStatus === 'past_due') {
    severity = 'critical';
    message = 'Subscription is past due. Product publishing is paused until payment is restored.';
  } else if (!hasActiveSubscription) {
    severity = 'notice';
    message = 'Subscription must be active before this store and its listings can appear publicly.';
  } else if (!hasPublicPlan) {
    severity = 'notice';
    message = 'Starter plan is for private setup only. Select an active Growth or Pro plan before this store can appear publicly.';
  } else if (!isRegistered) {
    severity = daysRemaining <= 7 ? 'critical' : daysRemaining <= 90 ? 'warning' : 'notice';
    message = daysRemaining < 0
      ? 'Registration window expired. Business registration is required before this store can appear publicly.'
      : `Business registration is required before this store and its listings can appear publicly. Registration assistance should be offered.`;
  }

  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    severity,
    message,
    canPublishProducts,
    eligibility: canPublishProducts
      ? { canSell: true, reason: 'registered_business_active_public_plan' }
      : isRegistered
        ? {
            canSell: false,
            reason: hasActiveSubscription ? 'public_subscription_plan_required' : 'active_subscription_required'
          }
      : {
          canSell: false,
          reason: 'registration_required_for_public_listing',
          registrationAssistanceOffered: true,
          expiresAt: unregisteredExpiry(vendor).toISOString(),
          daysRemaining
        }
  };
}

function registrationAutomationAlert(vendor) {
  const isRegistered = vendor.registrationStatus === 'registered';
  if (isRegistered) return null;

  const daysRemaining = daysUntilExpiry(vendor);
  if (daysRemaining < 0 || vendor.registrationStatus === 'expired') {
    return {
      alertType: 'registration_expired',
      severity: 'critical',
      message: 'Registration window expired. Business registration is required before this store can appear publicly.',
      dueDate: dateOnly(unregisteredExpiry(vendor))
    };
  }

  if (daysRemaining <= 7) {
    return {
      alertType: 'registration_7_day',
      severity: 'critical',
      message: `Registration support window ends in ${daysRemaining} days. This store stays private until business registration is completed.`,
      dueDate: dateOnly(unregisteredExpiry(vendor))
    };
  }

  if (daysRemaining <= 30) {
    return {
      alertType: 'registration_30_day',
      severity: 'warning',
      message: `Registration support window ends in ${daysRemaining} days. Registration documents should be completed soon so this store can go public.`,
      dueDate: dateOnly(unregisteredExpiry(vendor))
    };
  }

  if (daysRemaining <= 90) {
    return {
      alertType: 'registration_90_day',
      severity: 'warning',
      message: `Registration support window ends in ${daysRemaining} days. Offer registration assistance before this store goes public.`,
      dueDate: dateOnly(unregisteredExpiry(vendor))
    };
  }

  return null;
}

function canVendorPublish(vendor) {
  return !!vendor
    && vendor.subscriptionStatus === 'active'
    && vendor.registrationStatus === 'registered'
    && !isStarterPlan(vendor);
}

function assertPublishAllowed(vendor, action = 'publish') {
  if (canVendorPublish(vendor)) return;
  if (!vendor) {
    const error = new Error(`Vendor cannot ${action} because the vendor account is not active`);
    error.statusCode = 403;
    throw error;
  }
  const error = new Error(`Vendor cannot ${action} while subscription or registration compliance is not satisfied`);
  error.statusCode = 403;
  error.compliance = complianceAlertFor(vendor);
  throw error;
}

function slugFor(value) {
  return String(value || 'store')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `store-${Date.now()}`;
}

function normalizeStoreType(value) {
  const normalized = String(value || 'products').toLowerCase();
  return ['products', 'services', 'foods', 'mixed'].includes(normalized) ? normalized : 'products';
}

function storeTypeLabel(value) {
  return {
    foods: 'Foods',
    mixed: 'Mixed marketplace',
    products: 'Products',
    services: 'Services'
  }[normalizeStoreType(value)];
}

function coinsFromJmd(value) {
  return Math.max(0, Math.round(Number(value || 0) / COIN_JMD_RATE));
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizePaymentSession(session) {
  if (!session) return null;
  const metadata = parseMetadata(session.metadata);
  return {
    id: session.id,
    provider: session.provider,
    providerSessionId: session.providerSessionId ?? session.provider_session_id ?? null,
    vendorId: session.vendorId ?? session.vendor_id ?? null,
    vendorName: session.vendorName ?? null,
    orderId: session.orderId ?? session.order_id ?? null,
    serviceBookingId: session.serviceBookingId ?? session.service_booking_id ?? null,
    serviceName: session.serviceName ?? null,
    planId: session.planId ?? session.plan_id ?? null,
    planName: session.planName ?? null,
    kind: session.kind || metadata.kind || (session.orderId || session.order_id ? 'customer_order' : (session.serviceBookingId || session.service_booking_id ? 'service_booking' : 'vendor_subscription')),
    amount: Number(session.amount ?? session.amount_jmd ?? 0),
    status: session.status,
    checkoutUrl: session.checkoutUrl ?? session.checkout_url ?? null,
    createdAt: session.createdAt ?? session.created_at ?? null,
    paidAt: session.paidAt ?? session.paid_at ?? null
  };
}

function customizationKey(value, fallback = 'field') {
  const key = slugFor(value || fallback).replace(/-/g, '_').slice(0, 80);
  return key || fallback;
}

function customizationStatus(value, allowed, fallback) {
  const normalized = String(value || '').toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function intOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInt(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeCustomizationOption(row) {
  return {
    id: row.id,
    fieldId: row.fieldId,
    optionValue: row.optionValue,
    label: row.label,
    swatchColor: row.swatchColor || null,
    priceDeltaJmd: Number(row.priceDeltaJmd || 0),
    sortOrder: Number(row.sortOrder || 0),
    status: row.status || 'active',
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function normalizeCustomizationPlacement(row) {
  return {
    id: row.id,
    fieldId: row.fieldId,
    surfaceId: row.surfaceId,
    xPercent: Number(row.xPercent ?? 50),
    yPercent: Number(row.yPercent ?? 50),
    widthPercent: Number(row.widthPercent ?? 30),
    heightPercent: Number(row.heightPercent ?? 10),
    rotationDegrees: Number(row.rotationDegrees ?? 0),
    fontFamily: row.fontFamily || null,
    fontSizePercent: row.fontSizePercent === null || row.fontSizePercent === undefined ? null : Number(row.fontSizePercent),
    fontWeight: row.fontWeight || null,
    textAlign: row.textAlign || 'center',
    textColor: row.textColor || null,
    backgroundColor: row.backgroundColor || null,
    zIndex: Number(row.zIndex || 1),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function normalizeCustomizationField(row, options = [], placements = []) {
  return {
    id: row.id,
    templateId: row.templateId,
    fieldKey: row.fieldKey,
    label: row.label,
    fieldType: row.fieldType,
    placeholder: row.placeholder || '',
    helpText: row.helpText || '',
    isRequired: Boolean(row.isRequired),
    defaultValue: row.defaultValue ?? null,
    minLength: intOrNull(row.minLength),
    maxLength: intOrNull(row.maxLength),
    minValue: numberOrNull(row.minValue),
    maxValue: numberOrNull(row.maxValue),
    priceDeltaJmd: Number(row.priceDeltaJmd || 0),
    status: row.status || 'active',
    sortOrder: Number(row.sortOrder || 0),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    options,
    placements
  };
}

function normalizeCustomizationSurface(row) {
  return {
    id: row.id,
    templateId: row.templateId,
    name: row.name,
    surfaceKey: row.surfaceKey,
    baseImageUrl: row.baseImageUrl || '',
    widthPx: intOrNull(row.widthPx),
    heightPx: intOrNull(row.heightPx),
    sortOrder: Number(row.sortOrder || 0),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function normalizeCustomizationTemplate(row, surfaces = [], fields = []) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName || null,
    vendorId: row.vendorId || null,
    vendorName: row.vendorName || null,
    storeId: row.storeId || null,
    storeName: row.storeName || null,
    storeSlug: row.storeSlug || null,
    productType: row.productType || 'other',
    title: row.title || '',
    instructions: row.instructions || '',
    previewMode: row.previewMode || 'live_preview',
    status: row.status || 'draft',
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    surfaces,
    fields
  };
}

function customizationSurfaceGalleryImages(template, productName = '') {
  return (template?.surfaces || [])
    .filter((surface) => surface?.baseImageUrl)
    .map((surface, index) => ({
      id: `customization-surface-${surface.id || surface.surfaceKey || index}`,
      url: normalizeStoredMediaUrl(surface.baseImageUrl),
      altText: `${productName || 'Product'} ${surface.name || 'customizer'} view`,
      sortOrder: 1000 + Number(surface.sortOrder || index),
      sourceType: 'customization_surface',
      surfaceKey: surface.surfaceKey || null,
      surfaceName: surface.name || null
    }));
}

function mergeProductGalleryImages(images, customizationTemplate, productName = '') {
  const seen = new Set();
  return [
    ...(images || []),
    ...customizationSurfaceGalleryImages(customizationTemplate, productName)
  ].filter((image) => {
    const url = normalizeStoredMediaUrl(image?.url || '');
    if (!url) return false;
    const key = url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    image.url = url;
    return true;
  }).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

function groupByValue(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const value = row[key];
    const list = grouped.get(value) || [];
    list.push(row);
    grouped.set(value, list);
  }
  return grouped;
}

function customizationValuesMap(input) {
  const hasExplicitValues = input
    && typeof input === 'object'
    && (
      Object.prototype.hasOwnProperty.call(input, 'customizations')
      || Object.prototype.hasOwnProperty.call(input, 'customizationValues')
      || Object.prototype.hasOwnProperty.call(input, 'values')
    );
  const requestKeys = new Set(['productId', 'qty', 'quantity', 'previews', 'customizationPreviews', 'preview', 'previewReferences', 'customer', 'paymentMethod']);
  const looksLikeRequestBody = input
    && typeof input === 'object'
    && Object.keys(input).some((key) => requestKeys.has(key));
  const raw = hasExplicitValues
    ? input.customizations ?? input.customizationValues ?? input.values ?? {}
    : looksLikeRequestBody ? {} : input ?? {};
  const map = new Map();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const keys = [item.fieldId, item.fieldKey, item.key, item.name].filter(Boolean);
      for (const key of keys) {
        map.set(String(key), item);
      }
    }
    return map;
  }
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      map.set(key, { fieldKey: key, value });
    }
  }
  return map;
}

function customizationValueFromRecord(record) {
  if (!record || typeof record !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(record, 'value')) return record.value;
  if (record.fieldType === 'image' && Object.prototype.hasOwnProperty.call(record, 'valueJson')) return record.valueJson;
  if (Object.prototype.hasOwnProperty.call(record, 'valueText')) return record.valueText;
  if (Object.prototype.hasOwnProperty.call(record, 'valueJson')) return record.valueJson;
  if (Object.prototype.hasOwnProperty.call(record, 'url')) return record.url;
  if (Object.prototype.hasOwnProperty.call(record, 'imageUrl')) return record.imageUrl;
  return undefined;
}

function customizationValueText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    return String(value.label || value.name || value.url || value.imageUrl || JSON.stringify(value));
  }
  return String(value);
}

function normalizeCustomizationPreviews(input) {
  const raw = input?.previews ?? input?.customizationPreviews ?? input?.previewReferences ?? input?.preview ?? [];
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.entries(raw).map(([surfaceKey, value]) => (
          value && typeof value === 'object'
            ? { surfaceKey, ...value }
            : { surfaceKey, previewImageUrl: value }
        ))
      : [];

  return list
    .filter((preview) => preview && typeof preview === 'object')
    .map((preview) => ({
      surfaceKey: customizationKey(preview.surfaceKey || preview.key || 'surface', 'surface'),
      previewImageUrl: preview.previewImageUrl || preview.imageUrl || preview.url || null,
      previewJson: preview.previewJson ?? preview.layout ?? preview.data ?? null
    }));
}

function customizationSignature(customizations, previews = []) {
  if (!customizations.length && !previews.length) return '';
  const payload = {
    customizations: customizations.map((item) => ({
      fieldKey: item.fieldKey,
      valueText: item.valueText || '',
      valueJson: item.valueJson || null
    })),
    previews: previews.map((preview) => ({
      surfaceKey: preview.surfaceKey,
      previewImageUrl: preview.previewImageUrl || null,
      previewJson: preview.previewJson || null
    }))
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

function coordinateOrNull(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function cleanFileName(value, fallback) {
  return String(value || fallback)
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/^-+|-+$/g, '');
}

function safeResumeFileName(value) {
  const cleaned = cleanFileName(value, 'resume.pdf');
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned || 'resume'}.pdf`;
}

function extensionForMimeType(mimeType) {
  return VENDOR_DOCUMENT_TYPES.get(mimeType)?.[0] || '';
}

function listingImageExtensionForMimeType(mimeType) {
  return LISTING_IMAGE_TYPES.get(mimeType)?.[0] || '';
}

function safeDocumentFileName(value, mimeType) {
  const fallback = `registration-document${extensionForMimeType(mimeType) || '.pdf'}`;
  let cleaned = cleanFileName(value, fallback);
  const lowerName = cleaned.toLowerCase();
  const allowedExtensions = VENDOR_DOCUMENT_TYPES.get(mimeType) || [];
  const hasAllowedExtension = allowedExtensions.some((extension) => lowerName.endsWith(extension));
  if (!hasAllowedExtension) {
    cleaned = `${cleaned || 'registration-document'}${allowedExtensions[0] || '.bin'}`;
  }
  return cleaned;
}

function safeListingImageFileName(value, mimeType) {
  const fallback = `listing-photo${listingImageExtensionForMimeType(mimeType) || '.jpg'}`;
  let cleaned = cleanFileName(value, fallback);
  const lowerName = cleaned.toLowerCase();
  const allowedExtensions = LISTING_IMAGE_TYPES.get(mimeType) || [];
  const hasAllowedExtension = allowedExtensions.some((extension) => lowerName.endsWith(extension));
  if (!hasAllowedExtension) {
    cleaned = `${cleaned || 'listing-photo'}${allowedExtensions[0] || '.jpg'}`;
  }
  return cleaned;
}

function looksLikeAllowedDocument(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    return buffer.subarray(0, 4).toString('utf8') === '%PDF';
  }
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer.length >= 8
      && buffer[0] === 0x89
      && buffer[1] === 0x50
      && buffer[2] === 0x4e
      && buffer[3] === 0x47
      && buffer[4] === 0x0d
      && buffer[5] === 0x0a
      && buffer[6] === 0x1a
      && buffer[7] === 0x0a;
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('utf8') === 'RIFF'
      && buffer.subarray(8, 12).toString('utf8') === 'WEBP';
  }
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    return buffer.length >= 12 && buffer.subarray(4, 8).toString('utf8') === 'ftyp';
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  }
  if (mimeType === 'application/msword') {
    return buffer.length >= 4
      && buffer[0] === 0xd0
      && buffer[1] === 0xcf
      && buffer[2] === 0x11
      && buffer[3] === 0xe0;
  }
  return false;
}

function looksLikeAllowedImage(buffer, mimeType) {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer.length >= 8
      && buffer[0] === 0x89
      && buffer[1] === 0x50
      && buffer[2] === 0x4e
      && buffer[3] === 0x47
      && buffer[4] === 0x0d
      && buffer[5] === 0x0a
      && buffer[6] === 0x1a
      && buffer[7] === 0x0a;
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('utf8') === 'RIFF'
      && buffer.subarray(8, 12).toString('utf8') === 'WEBP';
  }
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    return buffer.length >= 12 && buffer.subarray(4, 8).toString('utf8') === 'ftyp';
  }
  return false;
}

async function saveResumeUpload(applicationId, body) {
  if (!body.resumeDataBase64) {
    return null;
  }

  const resumeName = safeResumeFileName(body.resumeName);
  const mimeType = String(body.resumeMimeType || 'application/pdf').toLowerCase();
  if (mimeType !== 'application/pdf' || !resumeName.toLowerCase().endsWith('.pdf')) {
    const error = new Error('Resume must be uploaded as a PDF file');
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(String(body.resumeDataBase64), 'base64');
  if (!buffer.length || buffer.length > MAX_RESUME_BYTES) {
    const error = new Error('Resume PDF must be 5 MB or smaller');
    error.statusCode = 400;
    throw error;
  }
  if (buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
    const error = new Error('Uploaded resume is not a valid PDF file');
    error.statusCode = 400;
    throw error;
  }

  await fs.mkdir(RESUME_UPLOAD_DIR, { recursive: true });
  const fileName = `${applicationId}-${resumeName}`;
  await fs.writeFile(path.join(RESUME_UPLOAD_DIR, fileName), buffer);
  const storageKey = `uploads/resumes/${fileName}`;
  await saveUploadedMedia(storageKey, fileName, 'resume', mimeType, buffer);
  return storageKey;
}

async function saveVendorDocumentUpload(documentId, body) {
  if (!body.documentDataBase64) {
    return body.fileUrl || body.url || null;
  }

  const mimeType = String(body.documentMimeType || '').toLowerCase();
  if (!VENDOR_DOCUMENT_TYPES.has(mimeType)) {
    const error = new Error('Upload a PDF, image, Word document, or DOCX file');
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(String(body.documentDataBase64), 'base64');
  if (!buffer.length || buffer.length > MAX_VENDOR_DOCUMENT_BYTES) {
    const error = new Error('Registration document must be 8 MB or smaller');
    error.statusCode = 400;
    throw error;
  }
  if (!looksLikeAllowedDocument(buffer, mimeType)) {
    const error = new Error('Uploaded registration document does not match the selected file type');
    error.statusCode = 400;
    throw error;
  }

  await fs.mkdir(VENDOR_DOCUMENT_UPLOAD_DIR, { recursive: true });
  const documentName = safeDocumentFileName(body.documentName, mimeType);
  const fileName = `${documentId}-${documentName}`;
  await fs.writeFile(path.join(VENDOR_DOCUMENT_UPLOAD_DIR, fileName), buffer);
  const storageKey = `uploads/vendor-documents/${fileName}`;
  await saveUploadedMedia(storageKey, fileName, 'vendor_document', mimeType, buffer);
  return storageKey;
}

function storageKeyHash(storageKey) {
  return createHash('sha256').update(String(storageKey || '')).digest('hex');
}

async function saveUploadedMedia(storageKey, fileName, mediaGroup, contentType, buffer) {
  if (!config.useDatabase || !Buffer.isBuffer(buffer) || !buffer.length) return;

  try {
    await query(`
      INSERT INTO uploaded_media (id, storage_key_hash, storage_key, file_name, media_group, content_type, size_bytes, data)
      VALUES (:id, :storageKeyHash, :storageKey, :fileName, :mediaGroup, :contentType, :sizeBytes, :data)
      ON DUPLICATE KEY UPDATE
        storage_key = VALUES(storage_key),
        file_name = VALUES(file_name),
        media_group = VALUES(media_group),
        content_type = VALUES(content_type),
        size_bytes = VALUES(size_bytes),
        data = VALUES(data)
    `, {
      id: randomUUID(),
      storageKeyHash: storageKeyHash(storageKey),
      storageKey,
      fileName,
      mediaGroup,
      contentType: contentType || 'application/octet-stream',
      sizeBytes: buffer.length,
      data: buffer
    });
  } catch (error) {
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error.code)) {
      console.warn('Uploaded media database backup skipped because uploaded_media is not available yet.');
      return;
    }
    throw error;
  }
}

function normalizeStoredMediaUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      if (parsed.pathname.startsWith('/api/uploads/')) {
        return `${parsed.pathname.replace(/^\/api\//, '')}${parsed.search}`;
      }
      if (parsed.pathname.startsWith('/uploads/')) {
        return `${parsed.pathname.replace(/^\//, '')}${parsed.search}`;
      }
    } catch {
      return text;
    }
    return text;
  }
  return text
    .replace(/^\/api\/uploads\//, 'uploads/')
    .replace(/^\/uploads\//, 'uploads/');
}

async function saveListingImageUpload(imageId, body) {
  if (!body.imageDataBase64) {
    return normalizeStoredMediaUrl(body.url || body.imageUrl || '') || null;
  }

  const mimeType = String(body.imageMimeType || '').toLowerCase();
  if (!LISTING_IMAGE_TYPES.has(mimeType)) {
    const error = new Error('Upload a JPG, PNG, WEBP, HEIC, or HEIF image');
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(String(body.imageDataBase64), 'base64');
  if (!buffer.length || buffer.length > MAX_LISTING_IMAGE_BYTES) {
    const error = new Error('Listing photo must be 8 MB or smaller');
    error.statusCode = 400;
    throw error;
  }
  if (!looksLikeAllowedImage(buffer, mimeType)) {
    const error = new Error('Uploaded listing photo does not match the selected image type');
    error.statusCode = 400;
    throw error;
  }

  await fs.mkdir(LISTING_MEDIA_UPLOAD_DIR, { recursive: true });
  const imageName = safeListingImageFileName(body.imageName, mimeType);
  const fileName = `${imageId}-${imageName}`;
  await fs.writeFile(path.join(LISTING_MEDIA_UPLOAD_DIR, fileName), buffer);
  const storageKey = `uploads/listing-media/${fileName}`;
  await saveUploadedMedia(storageKey, fileName, 'listing', mimeType, buffer);
  return storageKey;
}

async function saveCustomizationImageUpload(imageId, body) {
  if (!body.imageDataBase64) {
    return normalizeStoredMediaUrl(body.url || body.imageUrl || '') || null;
  }

  const mimeType = String(body.imageMimeType || '').toLowerCase();
  if (!LISTING_IMAGE_TYPES.has(mimeType)) {
    const error = new Error('Upload a JPG, PNG, WEBP, HEIC, or HEIF image');
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(String(body.imageDataBase64), 'base64');
  if (!buffer.length || buffer.length > MAX_LISTING_IMAGE_BYTES) {
    const error = new Error('Customer customization image must be 8 MB or smaller');
    error.statusCode = 400;
    throw error;
  }
  if (!looksLikeAllowedImage(buffer, mimeType)) {
    const error = new Error('Uploaded customization image does not match the selected image type');
    error.statusCode = 400;
    throw error;
  }

  await fs.mkdir(CUSTOMIZATION_MEDIA_UPLOAD_DIR, { recursive: true });
  const imageName = safeListingImageFileName(body.imageName, mimeType);
  const fileName = `${imageId}-${imageName}`;
  await fs.writeFile(path.join(CUSTOMIZATION_MEDIA_UPLOAD_DIR, fileName), buffer);
  const storageKey = `uploads/customization-media/${fileName}`;
  await saveUploadedMedia(storageKey, fileName, 'customization', mimeType, buffer);
  return storageKey;
}

function contentTypeForDocument(fileName) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  return {
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.webp': 'image/webp'
  }[extension] || 'application/octet-stream';
}

function contentTypeForListingImage(fileName) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  return {
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp'
  }[extension] || 'application/octet-stream';
}

async function listVendors(activeOnly = true, registeredOnly = false) {
  const where = [
    activeOnly ? "v.status = 'active'" : '',
    registeredOnly ? "v.registration_status = 'registered'" : '',
    registeredOnly ? "(st.id IS NULL OR st.status NOT IN ('paused', 'suspended'))" : '',
    registeredOnly ? "sub.status = 'active'" : '',
    registeredOnly ? "COALESCE(plan.code, 'starter') <> 'starter'" : ''
  ].filter(Boolean);
  const rows = await query(`
    SELECT
      v.id,
      v.business_name AS name,
      st.slug,
      st.location,
      st.address_line_1 AS addressLine1,
      st.address_line_2 AS addressLine2,
      st.parish,
      st.latitude,
      st.longitude,
      st.rating,
      st.summary,
      store_media_primary.logoUrl,
      store_media_primary.bannerUrl,
      store_gallery_media.galleryMedia,
      store_social_active.socialLinks,
      v.store_type AS storeType,
      v.registration_status AS registrationStatus,
      v.status AS status,
      v.onboarded_at AS onboardedAt,
      sub.status AS subscriptionStatus,
      plan.code AS subscriptionPlanCode,
      plan.name AS subscriptionPlan,
      sub.last_payment_at AS lastPaymentAt,
      sub.current_period_end AS nextBillingAt
    FROM vendors v
    LEFT JOIN stores st ON st.vendor_id = v.id
    ${primaryStoreMediaJoin()}
    ${storeGalleryMediaJoin()}
    ${activeStoreSocialLinksJoin()}
    ${latestVendorSubscriptionJoin('sub')}
    LEFT JOIN subscription_plans plan ON plan.id = sub.plan_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY st.name, v.business_name
  `);

  return rows.map((row) => ({
    ...row,
    rating: Number(row.rating || 0),
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    deliveryDays: ['Mon', 'Wed', 'Fri'],
    categories: [storeTypeLabel(row.storeType)],
    storeType: normalizeStoreType(row.storeType),
    onboardedAt: dateOnly(row.onboardedAt),
    lastPaymentAt: row.lastPaymentAt ? dateOnly(row.lastPaymentAt) : null,
    nextBillingAt: row.nextBillingAt ? dateOnly(row.nextBillingAt) : null,
    logoUrl: row.logoUrl || null,
    bannerUrl: row.bannerUrl || null,
    galleryMedia: asJsonArray(row.galleryMedia).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
    socialLinks: asJsonArray(row.socialLinks).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
    subscriptionStatus: row.subscriptionStatus || 'trial',
    subscriptionPlanCode: row.subscriptionPlanCode || 'starter',
    subscriptionPlan: row.subscriptionPlan || 'Starter vendor'
  }));
}

async function findVendorById(id) {
  const vendors = await listVendors();
  return vendors.find((vendor) => vendor.id === id);
}

async function findVendorBySlug(slug) {
  const vendors = await listVendors();
  return vendors.find((vendor) => vendor.slug === slug);
}

async function findPublicVendorBySlug(slug) {
  const vendors = await listVendors(true, true);
  return vendors.find((vendor) => vendor.slug === slug);
}

async function listProducts() {
  const rows = await query(`
    SELECT
      p.id,
      p.name,
      p.vendor_id AS vendorId,
      p.store_id AS storeId,
      v.business_name AS vendorName,
      st.slug AS storeSlug,
      st.name AS storeName,
      p.type AS category,
      p.price_jmd AS price,
      p.stock_quantity AS stockQuantity,
      p.delivery_day AS deliveryDay,
      p.description,
      product_image.imageUrl,
      customization_image.imageUrl AS customizationImageUrl,
      customization_template.id AS customizationTemplateId,
      feature.featuredUntil
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    JOIN stores st ON st.id = p.store_id AND st.status NOT IN ('paused', 'suspended')
    ${primaryProductImageJoin()}
    ${primaryProductCustomizationImageJoin()}
    LEFT JOIN product_customization_templates customization_template
      ON customization_template.product_id = p.id AND customization_template.status = 'active'
    LEFT JOIN (
      SELECT product_id AS productId, MAX(ends_at) AS featuredUntil
      FROM product_features
      WHERE status = 'active' AND ends_at > NOW()
      GROUP BY product_id
    ) feature ON feature.productId = p.id
    WHERE p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
    ORDER BY feature.featuredUntil IS NULL, p.created_at DESC
  `);

  return Promise.all(rows.map(async (row) => {
    const originalPrice = Number(row.price || 0);
    const discount = await bestDiscountForProduct(row, null, originalPrice);
    const price = discountedUnitPrice(originalPrice, discount);
    return {
      ...row,
      category: row.category === 'food' ? 'Food' : 'Products',
      originalPrice,
      price,
      hasDiscount: price < originalPrice,
      discount: normalizeDiscount(discount),
      stockQuantity: Number(row.stockQuantity || 0),
      imageUrl: row.imageUrl || row.customizationImageUrl || '',
      featuredUntil: row.featuredUntil || null,
      isFeatured: Boolean(row.featuredUntil),
      isCustomizable: Boolean(row.customizationTemplateId),
      rating: 4.8
    };
  }));
}

async function findPublicProductById(productId) {
  const rows = await query(`
    SELECT
      p.id,
      p.name,
      p.vendor_id AS vendorId,
      p.store_id AS storeId,
      v.business_name AS vendorName,
      st.slug AS storeSlug,
      st.name AS storeName,
      p.type AS category,
      p.price_jmd AS price,
      p.stock_quantity AS stockQuantity,
      p.delivery_day AS deliveryDay,
      p.description,
      product_image.imageUrl,
      customization_image.imageUrl AS customizationImageUrl,
      product_gallery.images,
      feature.featuredUntil
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    JOIN stores st ON st.id = p.store_id AND st.status NOT IN ('paused', 'suspended')
    ${primaryProductImageJoin()}
    ${primaryProductCustomizationImageJoin()}
    ${productImageGalleryJoin()}
    LEFT JOIN (
      SELECT product_id AS productId, MAX(ends_at) AS featuredUntil
      FROM product_features
      WHERE status = 'active' AND ends_at > NOW()
      GROUP BY product_id
    ) feature ON feature.productId = p.id
    WHERE p.id = :productId
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
    LIMIT 1
  `, { productId });

  const row = rows[0];
  if (!row) return null;
  const originalPrice = Number(row.price || 0);
  const discount = await bestDiscountForProduct(row, null, originalPrice);
  const price = discountedUnitPrice(originalPrice, discount);
  const productImages = asJsonArray(row.images)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const customizationTemplate = await customizationTemplateByProductId(productId, { publicOnly: true });
  const images = mergeProductGalleryImages(productImages, customizationTemplate, row.name);
  return {
    ...row,
    category: row.category === 'food' ? 'Food' : 'Products',
    originalPrice,
    price,
    hasDiscount: price < originalPrice,
    discount: normalizeDiscount(discount),
    stockQuantity: Number(row.stockQuantity || 0),
    featuredUntil: row.featuredUntil || null,
    isFeatured: Boolean(row.featuredUntil),
    imageUrl: row.imageUrl || row.customizationImageUrl || images[0]?.url || '',
    images,
    customizationTemplate,
    isCustomizable: Boolean(customizationTemplate),
    rating: 4.8
  };
}

async function hydrateCustomizationTemplates(rows) {
  if (!rows.length) return [];
  const templateIds = rows.map((row) => row.id);
  const idList = templateIds.join(',');
  const [surfaceRows, fieldRows, optionRows, placementRows] = await Promise.all([
    query(`
      SELECT id, template_id AS templateId, name, surface_key AS surfaceKey, base_image_url AS baseImageUrl, width_px AS widthPx, height_px AS heightPx, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
      FROM product_customization_surfaces
      WHERE FIND_IN_SET(template_id, :templateIds)
      ORDER BY sort_order, created_at
    `, { templateIds: idList }),
    query(`
      SELECT id, template_id AS templateId, field_key AS fieldKey, label, field_type AS fieldType, placeholder, help_text AS helpText, is_required AS isRequired, default_value AS defaultValue, min_length AS minLength, max_length AS maxLength, min_value AS minValue, max_value AS \`maxValue\`, price_delta_jmd AS priceDeltaJmd, status, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
      FROM product_customization_fields
      WHERE FIND_IN_SET(template_id, :templateIds)
      ORDER BY sort_order, created_at
    `, { templateIds: idList }),
    query(`
      SELECT o.id, o.field_id AS fieldId, o.option_value AS optionValue, o.label, o.swatch_color AS swatchColor, o.price_delta_jmd AS priceDeltaJmd, o.sort_order AS sortOrder, o.status, o.created_at AS createdAt, o.updated_at AS updatedAt
      FROM product_customization_field_options o
      JOIN product_customization_fields f ON f.id = o.field_id
      WHERE FIND_IN_SET(f.template_id, :templateIds)
      ORDER BY o.sort_order, o.created_at
    `, { templateIds: idList }),
    query(`
      SELECT p.id, p.field_id AS fieldId, p.surface_id AS surfaceId, p.x_percent AS xPercent, p.y_percent AS yPercent, p.width_percent AS widthPercent, p.height_percent AS heightPercent, p.rotation_degrees AS rotationDegrees, p.font_family AS fontFamily, p.font_size_percent AS fontSizePercent, p.font_weight AS fontWeight, p.text_align AS textAlign, p.text_color AS textColor, p.background_color AS backgroundColor, p.z_index AS zIndex, p.created_at AS createdAt, p.updated_at AS updatedAt
      FROM product_customization_placements p
      JOIN product_customization_fields f ON f.id = p.field_id
      WHERE FIND_IN_SET(f.template_id, :templateIds)
      ORDER BY p.z_index, p.created_at
    `, { templateIds: idList })
  ]);
  const surfacesByTemplate = groupByValue(surfaceRows.map(normalizeCustomizationSurface), 'templateId');
  const optionsByField = groupByValue(optionRows.map(normalizeCustomizationOption), 'fieldId');
  const placementsByField = groupByValue(placementRows.map(normalizeCustomizationPlacement), 'fieldId');
  const fieldsByTemplate = groupByValue(fieldRows.map((field) => normalizeCustomizationField(
    field,
    optionsByField.get(field.id) || [],
    placementsByField.get(field.id) || []
  )), 'templateId');

  return rows.map((row) => normalizeCustomizationTemplate(
    row,
    surfacesByTemplate.get(row.id) || [],
    fieldsByTemplate.get(row.id) || []
  ));
}

async function listCustomizationTemplates(filters = {}) {
  const where = [];
  const params = {};
  if (filters.productId) {
    where.push('t.product_id = :productId');
    params.productId = filters.productId;
  }
  if (filters.templateId) {
    where.push('t.id = :templateId');
    params.templateId = filters.templateId;
  }
  if (filters.status) {
    where.push('t.status = :status');
    params.status = filters.status;
  }
  if (filters.publicOnly) {
    where.push("t.status = 'active'");
    where.push("p.status = 'published'");
    where.push("v.status = 'active'");
    where.push("v.registration_status = 'registered'");
    where.push("st.status NOT IN ('paused', 'suspended')");
  }
  if (filters.vendorIds?.length) {
    where.push('FIND_IN_SET(p.vendor_id, :vendorIds)');
    params.vendorIds = filters.vendorIds.join(',');
  }
  const rows = await query(`
    SELECT
      t.id,
      t.product_id AS productId,
      p.name AS productName,
      p.vendor_id AS vendorId,
      v.business_name AS vendorName,
      p.store_id AS storeId,
      st.name AS storeName,
      st.slug AS storeSlug,
      t.product_type AS productType,
      t.title,
      t.instructions,
      t.preview_mode AS previewMode,
      t.status,
      t.created_at AS createdAt,
      t.updated_at AS updatedAt
    FROM product_customization_templates t
    JOIN products p ON p.id = t.product_id
    JOIN vendors v ON v.id = p.vendor_id
    ${filters.publicOnly ? publicVendorSubscriptionJoin() : ''}
    JOIN stores st ON st.id = p.store_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.updated_at DESC, t.created_at DESC
  `, params);

  return hydrateCustomizationTemplates(rows);
}

async function customizationTemplateByProductId(productId, options = {}) {
  const templates = await listCustomizationTemplates({
    productId,
    publicOnly: Boolean(options.publicOnly),
    status: options.status
  });
  return templates[0] || null;
}

async function customizationTemplateById(templateId, options = {}) {
  const templates = await listCustomizationTemplates({
    templateId,
    publicOnly: Boolean(options.publicOnly),
    status: options.status
  });
  return templates[0] || null;
}

async function productForCustomization(productId) {
  const rows = await query(`
    SELECT p.id, p.name, p.vendor_id AS vendorId, p.store_id AS storeId
    FROM products p
    WHERE p.id = :productId
    LIMIT 1
  `, { productId });
  return rows[0] || null;
}

async function vendorIdForCustomizationTemplate(templateId) {
  const rows = await query(`
    SELECT p.vendor_id AS vendorId
    FROM product_customization_templates t
    JOIN products p ON p.id = t.product_id
    WHERE t.id = :templateId
    LIMIT 1
  `, { templateId });
  return rows[0]?.vendorId || null;
}

async function vendorIdForCustomizationSurface(surfaceId) {
  const rows = await query(`
    SELECT p.vendor_id AS vendorId
    FROM product_customization_surfaces s
    JOIN product_customization_templates t ON t.id = s.template_id
    JOIN products p ON p.id = t.product_id
    WHERE s.id = :surfaceId
    LIMIT 1
  `, { surfaceId });
  return rows[0]?.vendorId || null;
}

async function vendorIdForCustomizationField(fieldId) {
  const rows = await query(`
    SELECT p.vendor_id AS vendorId
    FROM product_customization_fields f
    JOIN product_customization_templates t ON t.id = f.template_id
    JOIN products p ON p.id = t.product_id
    WHERE f.id = :fieldId
    LIMIT 1
  `, { fieldId });
  return rows[0]?.vendorId || null;
}

async function vendorIdForCustomizationOption(optionId) {
  const rows = await query(`
    SELECT p.vendor_id AS vendorId
    FROM product_customization_field_options o
    JOIN product_customization_fields f ON f.id = o.field_id
    JOIN product_customization_templates t ON t.id = f.template_id
    JOIN products p ON p.id = t.product_id
    WHERE o.id = :optionId
    LIMIT 1
  `, { optionId });
  return rows[0]?.vendorId || null;
}

async function vendorIdForCustomizationPlacement(placementId) {
  const rows = await query(`
    SELECT p.vendor_id AS vendorId
    FROM product_customization_placements placement
    JOIN product_customization_fields f ON f.id = placement.field_id
    JOIN product_customization_templates t ON t.id = f.template_id
    JOIN products p ON p.id = t.product_id
    WHERE placement.id = :placementId
    LIMIT 1
  `, { placementId });
  return rows[0]?.vendorId || null;
}

async function upsertProductCustomizationTemplate(productId, body = {}) {
  const product = await productForCustomization(productId);
  if (!product) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    throw error;
  }
  const existing = await customizationTemplateByProductId(productId);
  const id = existing?.id || body.id || randomUUID();
  const status = customizationStatus(body.status, CUSTOMIZATION_TEMPLATE_STATUSES, existing?.status || 'draft');
  const previewMode = body.previewMode === 'form' ? 'form' : 'live_preview';
  await query(`
    INSERT INTO product_customization_templates (id, product_id, product_type, title, instructions, preview_mode, status)
    VALUES (:id, :productId, :productType, :title, :instructions, :previewMode, :status)
    ON DUPLICATE KEY UPDATE
      product_type = VALUES(product_type),
      title = VALUES(title),
      instructions = VALUES(instructions),
      preview_mode = VALUES(preview_mode),
      status = VALUES(status)
  `, {
    id,
    productId,
    productType: customizationKey(body.productType || existing?.productType || 'other', 'other'),
    title: body.title ?? existing?.title ?? '',
    instructions: body.instructions ?? existing?.instructions ?? '',
    previewMode,
    status
  });

  const templateId = existing?.id || id;
  const surfaceIdMap = new Map();
  if (Array.isArray(body.surfaces)) {
    const surfaceKeys = [...new Set(body.surfaces
      .map((surface) => customizationKey(surface.surfaceKey || surface.key || surface.name || 'front', 'front'))
      .filter(Boolean))];
    for (const surface of body.surfaces) {
      await saveCustomizationSurface(templateId, surface, surface.id || null);
    }
    if (surfaceKeys.length) {
      const savedSurfaces = await query(`
        SELECT id, surface_key AS surfaceKey
        FROM product_customization_surfaces
        WHERE template_id = :templateId AND FIND_IN_SET(surface_key, :surfaceKeys)
      `, { templateId, surfaceKeys: surfaceKeys.join(',') });
      const savedSurfaceByKey = new Map(savedSurfaces.map((surface) => [surface.surfaceKey, surface.id]));
      for (const surface of body.surfaces) {
        const key = customizationKey(surface.surfaceKey || surface.key || surface.name || 'front', 'front');
        const savedId = savedSurfaceByKey.get(key);
        if (surface.id && savedId) {
          surfaceIdMap.set(surface.id, savedId);
        }
      }
      await query(`
        DELETE FROM product_customization_surfaces
        WHERE template_id = :templateId AND NOT FIND_IN_SET(surface_key, :surfaceKeys)
      `, { templateId, surfaceKeys: surfaceKeys.join(',') });
    }
  }
  if (Array.isArray(body.fields)) {
    const fields = body.fields.map((field) => ({
      ...field,
      placements: Array.isArray(field.placements)
        ? field.placements.map((placement) => ({
            ...placement,
            surfaceId: surfaceIdMap.get(placement.surfaceId) || placement.surfaceId
          }))
        : field.placements
    }));
    const fieldKeys = [...new Set(fields
      .map((field) => customizationKey(field.fieldKey || field.key || field.label || 'field', 'field'))
      .filter(Boolean))];
    for (const field of fields) {
      await saveCustomizationField(templateId, field, field.id || null);
    }
    if (fieldKeys.length) {
      await query(`
        DELETE FROM product_customization_fields
        WHERE template_id = :templateId AND NOT FIND_IN_SET(field_key, :fieldKeys)
      `, { templateId, fieldKeys: fieldKeys.join(',') });
    }
  }
  return customizationTemplateByProductId(productId);
}

async function updateCustomizationTemplateStatus(templateId, body = {}) {
  const status = customizationStatus(body.status, CUSTOMIZATION_TEMPLATE_STATUSES, '');
  if (!status) {
    const error = new Error('Customization template status must be draft, active, or paused');
    error.statusCode = 400;
    throw error;
  }
  await query('UPDATE product_customization_templates SET status = :status WHERE id = :templateId', { templateId, status });
  const template = await customizationTemplateById(templateId);
  if (!template) {
    const error = new Error('Customization template not found');
    error.statusCode = 404;
    throw error;
  }
  return template;
}

async function saveCustomizationSurface(templateId, body = {}, surfaceId = null) {
  const template = await customizationTemplateById(templateId);
  if (!template) {
    const error = new Error('Customization template not found');
    error.statusCode = 404;
    throw error;
  }
  const requestedSurfaceKey = customizationKey(body.surfaceKey || body.key || body.name || 'front', 'front');
  let existingRows = surfaceId ? await query(`
    SELECT id, template_id AS templateId, name, surface_key AS surfaceKey, base_image_url AS baseImageUrl, width_px AS widthPx, height_px AS heightPx, sort_order AS sortOrder
    FROM product_customization_surfaces
    WHERE id = :surfaceId AND template_id = :templateId
    LIMIT 1
  `, { surfaceId, templateId }) : [];
  if (!existingRows[0] && requestedSurfaceKey) {
    existingRows = await query(`
      SELECT id, template_id AS templateId, name, surface_key AS surfaceKey, base_image_url AS baseImageUrl, width_px AS widthPx, height_px AS heightPx, sort_order AS sortOrder
      FROM product_customization_surfaces
      WHERE template_id = :templateId AND surface_key = :surfaceKey
      LIMIT 1
    `, { templateId, surfaceKey: requestedSurfaceKey });
  }
  const existing = existingRows[0] || null;
  const id = existing?.id || surfaceId || body.id || randomUUID();
  const surfaceKey = customizationKey(body.surfaceKey || body.key || existing?.surfaceKey || body.name || 'front', 'front');
  const imageBody = body.imageDataBase64 ? body : null;
  const baseImageUrl = imageBody
    ? await saveCustomizationImageUpload(id, imageBody)
    : normalizeStoredMediaUrl(body.baseImageUrl ?? body.imageUrl ?? existing?.baseImageUrl ?? '') || null;
  await query(`
    INSERT INTO product_customization_surfaces (id, template_id, name, surface_key, base_image_url, width_px, height_px, sort_order)
    VALUES (:id, :templateId, :name, :surfaceKey, :baseImageUrl, :widthPx, :heightPx, :sortOrder)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      surface_key = VALUES(surface_key),
      base_image_url = VALUES(base_image_url),
      width_px = VALUES(width_px),
      height_px = VALUES(height_px),
      sort_order = VALUES(sort_order)
  `, {
    id,
    templateId,
    name: String(body.name || existing?.name || 'Front').trim(),
    surfaceKey,
    baseImageUrl,
    widthPx: intOrNull(body.widthPx ?? existing?.widthPx),
    heightPx: intOrNull(body.heightPx ?? existing?.heightPx),
    sortOrder: nonNegativeInt(body.sortOrder ?? existing?.sortOrder, 0)
  });
  return customizationTemplateById(templateId);
}

async function updateCustomizationSurface(surfaceId, body = {}) {
  const rows = await query('SELECT template_id AS templateId FROM product_customization_surfaces WHERE id = :surfaceId LIMIT 1', { surfaceId });
  if (!rows[0]) {
    const error = new Error('Customization surface not found');
    error.statusCode = 404;
    throw error;
  }
  return saveCustomizationSurface(rows[0].templateId, body, surfaceId);
}

async function updateCustomizationSurfaceImage(surfaceId, body = {}) {
  const rows = await query('SELECT template_id AS templateId FROM product_customization_surfaces WHERE id = :surfaceId LIMIT 1', { surfaceId });
  if (!rows[0]) {
    const error = new Error('Customization surface not found');
    error.statusCode = 404;
    throw error;
  }
  const url = await saveListingImageUpload(surfaceId, body);
  if (!url) {
    const error = new Error('Choose a base product image or provide an image URL');
    error.statusCode = 400;
    throw error;
  }
  await query('UPDATE product_customization_surfaces SET base_image_url = :url WHERE id = :surfaceId', { surfaceId, url });
  return customizationTemplateById(rows[0].templateId);
}

async function deleteCustomizationSurface(surfaceId) {
  const rows = await query('SELECT template_id AS templateId FROM product_customization_surfaces WHERE id = :surfaceId LIMIT 1', { surfaceId });
  if (!rows[0]) {
    const error = new Error('Customization surface not found');
    error.statusCode = 404;
    throw error;
  }
  await query('DELETE FROM product_customization_surfaces WHERE id = :surfaceId', { surfaceId });
  return customizationTemplateById(rows[0].templateId);
}

async function saveCustomizationField(templateId, body = {}, fieldId = null) {
  const template = await customizationTemplateById(templateId);
  if (!template) {
    const error = new Error('Customization template not found');
    error.statusCode = 404;
    throw error;
  }
  const label = String(body.label || 'Custom field').trim();
  const requestedFieldKey = customizationKey(body.fieldKey || body.key || label, 'field');
  let existingRows = fieldId ? await query(`
    SELECT id, template_id AS templateId, field_key AS fieldKey, label, field_type AS fieldType, placeholder, help_text AS helpText, is_required AS isRequired, default_value AS defaultValue, min_length AS minLength, max_length AS maxLength, min_value AS minValue, max_value AS \`maxValue\`, price_delta_jmd AS priceDeltaJmd, status, sort_order AS sortOrder
    FROM product_customization_fields
    WHERE id = :fieldId AND template_id = :templateId
    LIMIT 1
  `, { fieldId, templateId }) : [];
  if (!existingRows[0] && requestedFieldKey) {
    existingRows = await query(`
      SELECT id, template_id AS templateId, field_key AS fieldKey, label, field_type AS fieldType, placeholder, help_text AS helpText, is_required AS isRequired, default_value AS defaultValue, min_length AS minLength, max_length AS maxLength, min_value AS minValue, max_value AS \`maxValue\`, price_delta_jmd AS priceDeltaJmd, status, sort_order AS sortOrder
      FROM product_customization_fields
      WHERE template_id = :templateId AND field_key = :fieldKey
      LIMIT 1
    `, { templateId, fieldKey: requestedFieldKey });
  }
  const existing = existingRows[0] || null;
  const id = existing?.id || fieldId || body.id || randomUUID();
  const fieldType = CUSTOMIZATION_FIELD_TYPES.has(String(body.fieldType || existing?.fieldType || '').toLowerCase())
    ? String(body.fieldType || existing?.fieldType).toLowerCase()
    : 'text';
  const savedLabel = String(body.label || existing?.label || 'Custom field').trim();
  const fieldKey = customizationKey(body.fieldKey || body.key || existing?.fieldKey || savedLabel, 'field');
  await query(`
    INSERT INTO product_customization_fields (id, template_id, field_key, label, field_type, placeholder, help_text, is_required, default_value, min_length, max_length, min_value, max_value, price_delta_jmd, status, sort_order)
    VALUES (:id, :templateId, :fieldKey, :label, :fieldType, :placeholder, :helpText, :isRequired, :defaultValue, :minLength, :maxLength, :minValue, :maxValue, :priceDeltaJmd, :status, :sortOrder)
    ON DUPLICATE KEY UPDATE
      field_key = VALUES(field_key),
      label = VALUES(label),
      field_type = VALUES(field_type),
      placeholder = VALUES(placeholder),
      help_text = VALUES(help_text),
      is_required = VALUES(is_required),
      default_value = VALUES(default_value),
      min_length = VALUES(min_length),
      max_length = VALUES(max_length),
      min_value = VALUES(min_value),
      max_value = VALUES(max_value),
      price_delta_jmd = VALUES(price_delta_jmd),
      status = VALUES(status),
      sort_order = VALUES(sort_order)
  `, {
    id,
    templateId,
    fieldKey,
    label: savedLabel || existing?.label || 'Custom field',
    fieldType,
    placeholder: body.placeholder ?? existing?.placeholder ?? null,
    helpText: body.helpText ?? existing?.helpText ?? null,
    isRequired: body.isRequired === undefined ? Boolean(existing?.isRequired) : Boolean(body.isRequired),
    defaultValue: body.defaultValue ?? existing?.defaultValue ?? null,
    minLength: intOrNull(body.minLength ?? existing?.minLength),
    maxLength: intOrNull(body.maxLength ?? existing?.maxLength),
    minValue: numberOrNull(body.minValue ?? existing?.minValue),
    maxValue: numberOrNull(body.maxValue ?? existing?.maxValue),
    priceDeltaJmd: nonNegativeInt(body.priceDeltaJmd ?? existing?.priceDeltaJmd, 0),
    status: customizationStatus(body.status, CUSTOMIZATION_FIELD_STATUSES, existing?.status || 'active'),
    sortOrder: nonNegativeInt(body.sortOrder ?? existing?.sortOrder, 0)
  });

  const savedFieldId = existing?.id || id;
  if (Array.isArray(body.options)) {
    await query('DELETE FROM product_customization_field_options WHERE field_id = :fieldId', { fieldId: savedFieldId });
    for (const option of body.options) {
      await saveCustomizationFieldOption(savedFieldId, option, option.id || null);
    }
  }
  if (Array.isArray(body.placements)) {
    const placementIds = body.placements.map((placement) => placement.id).filter(Boolean);
    if (placementIds.length) {
      await query(`
        DELETE FROM product_customization_placements
        WHERE field_id = :fieldId AND NOT FIND_IN_SET(id, :placementIds)
      `, { fieldId: savedFieldId, placementIds: placementIds.join(',') });
    } else {
      await query('DELETE FROM product_customization_placements WHERE field_id = :fieldId', { fieldId: savedFieldId });
    }
    for (const placement of body.placements) {
      await saveCustomizationPlacement(savedFieldId, placement, placement.id || null);
    }
  }
  return customizationTemplateById(templateId);
}

async function updateCustomizationField(fieldId, body = {}) {
  const rows = await query('SELECT template_id AS templateId FROM product_customization_fields WHERE id = :fieldId LIMIT 1', { fieldId });
  if (!rows[0]) {
    const error = new Error('Customization field not found');
    error.statusCode = 404;
    throw error;
  }
  return saveCustomizationField(rows[0].templateId, body, fieldId);
}

async function deleteCustomizationField(fieldId) {
  const rows = await query('SELECT template_id AS templateId FROM product_customization_fields WHERE id = :fieldId LIMIT 1', { fieldId });
  if (!rows[0]) {
    const error = new Error('Customization field not found');
    error.statusCode = 404;
    throw error;
  }
  await query('DELETE FROM product_customization_fields WHERE id = :fieldId', { fieldId });
  return customizationTemplateById(rows[0].templateId);
}

async function saveCustomizationFieldOption(fieldId, body = {}, optionId = null) {
  const fieldRows = await query('SELECT id, template_id AS templateId FROM product_customization_fields WHERE id = :fieldId LIMIT 1', { fieldId });
  if (!fieldRows[0]) {
    const error = new Error('Customization field not found');
    error.statusCode = 404;
    throw error;
  }
  const existingRows = optionId ? await query(`
    SELECT id, field_id AS fieldId, option_value AS optionValue, label, swatch_color AS swatchColor, price_delta_jmd AS priceDeltaJmd, sort_order AS sortOrder, status
    FROM product_customization_field_options
    WHERE id = :optionId AND field_id = :fieldId
    LIMIT 1
  `, { optionId, fieldId }) : [];
  const existing = existingRows[0] || null;
  const id = existing?.id || optionId || body.id || randomUUID();
  const label = String(body.label || existing?.label || body.optionValue || body.value || 'Option').trim();
  await query(`
    INSERT INTO product_customization_field_options (id, field_id, option_value, label, swatch_color, price_delta_jmd, sort_order, status)
    VALUES (:id, :fieldId, :optionValue, :label, :swatchColor, :priceDeltaJmd, :sortOrder, :status)
    ON DUPLICATE KEY UPDATE
      label = VALUES(label),
      swatch_color = VALUES(swatch_color),
      price_delta_jmd = VALUES(price_delta_jmd),
      sort_order = VALUES(sort_order),
      status = VALUES(status)
  `, {
    id,
    fieldId,
    optionValue: customizationKey(body.optionValue || body.value || existing?.optionValue || label, 'option'),
    label,
    swatchColor: body.swatchColor ?? existing?.swatchColor ?? null,
    priceDeltaJmd: nonNegativeInt(body.priceDeltaJmd ?? existing?.priceDeltaJmd, 0),
    sortOrder: nonNegativeInt(body.sortOrder ?? existing?.sortOrder, 0),
    status: customizationStatus(body.status, CUSTOMIZATION_FIELD_STATUSES, existing?.status || 'active')
  });
  return customizationTemplateById(fieldRows[0].templateId);
}

async function updateCustomizationFieldOption(optionId, body = {}) {
  const rows = await query('SELECT field_id AS fieldId FROM product_customization_field_options WHERE id = :optionId LIMIT 1', { optionId });
  if (!rows[0]) {
    const error = new Error('Customization option not found');
    error.statusCode = 404;
    throw error;
  }
  return saveCustomizationFieldOption(rows[0].fieldId, body, optionId);
}

async function deleteCustomizationFieldOption(optionId) {
  const rows = await query(`
    SELECT f.template_id AS templateId
    FROM product_customization_field_options o
    JOIN product_customization_fields f ON f.id = o.field_id
    WHERE o.id = :optionId
    LIMIT 1
  `, { optionId });
  if (!rows[0]) {
    const error = new Error('Customization option not found');
    error.statusCode = 404;
    throw error;
  }
  await query('DELETE FROM product_customization_field_options WHERE id = :optionId', { optionId });
  return customizationTemplateById(rows[0].templateId);
}

async function saveCustomizationPlacement(fieldId, body = {}, placementId = null) {
  const fieldRows = await query('SELECT id, template_id AS templateId FROM product_customization_fields WHERE id = :fieldId LIMIT 1', { fieldId });
  if (!fieldRows[0]) {
    const error = new Error('Customization field not found');
    error.statusCode = 404;
    throw error;
  }
  const surfaceId = body.surfaceId;
  if (!surfaceId) {
    const error = new Error('Customization placement requires a surfaceId');
    error.statusCode = 400;
    throw error;
  }
  const surfaceRows = await query('SELECT id FROM product_customization_surfaces WHERE id = :surfaceId AND template_id = :templateId LIMIT 1', {
    surfaceId,
    templateId: fieldRows[0].templateId
  });
  if (!surfaceRows[0]) {
    const error = new Error('Placement surface must belong to the same customization template');
    error.statusCode = 400;
    throw error;
  }
  let existingRows = placementId ? await query(`
    SELECT id, field_id AS fieldId, surface_id AS surfaceId, x_percent AS xPercent, y_percent AS yPercent, width_percent AS widthPercent, height_percent AS heightPercent, rotation_degrees AS rotationDegrees, font_family AS fontFamily, font_size_percent AS fontSizePercent, font_weight AS fontWeight, text_align AS textAlign, text_color AS textColor, background_color AS backgroundColor, z_index AS zIndex
    FROM product_customization_placements
    WHERE id = :placementId AND field_id = :fieldId
    LIMIT 1
  `, { placementId, fieldId }) : [];
  if (!existingRows[0]) {
    existingRows = await query(`
      SELECT id, field_id AS fieldId, surface_id AS surfaceId, x_percent AS xPercent, y_percent AS yPercent, width_percent AS widthPercent, height_percent AS heightPercent, rotation_degrees AS rotationDegrees, font_family AS fontFamily, font_size_percent AS fontSizePercent, font_weight AS fontWeight, text_align AS textAlign, text_color AS textColor, background_color AS backgroundColor, z_index AS zIndex
      FROM product_customization_placements
      WHERE field_id = :fieldId AND surface_id = :surfaceId
      LIMIT 1
    `, { fieldId, surfaceId });
  }
  const existing = existingRows[0] || null;
  const id = existing?.id || placementId || body.id || randomUUID();
  await query(`
    INSERT INTO product_customization_placements (id, field_id, surface_id, x_percent, y_percent, width_percent, height_percent, rotation_degrees, font_family, font_size_percent, font_weight, text_align, text_color, background_color, z_index)
    VALUES (:id, :fieldId, :surfaceId, :xPercent, :yPercent, :widthPercent, :heightPercent, :rotationDegrees, :fontFamily, :fontSizePercent, :fontWeight, :textAlign, :textColor, :backgroundColor, :zIndex)
    ON DUPLICATE KEY UPDATE
      x_percent = VALUES(x_percent),
      y_percent = VALUES(y_percent),
      width_percent = VALUES(width_percent),
      height_percent = VALUES(height_percent),
      rotation_degrees = VALUES(rotation_degrees),
      font_family = VALUES(font_family),
      font_size_percent = VALUES(font_size_percent),
      font_weight = VALUES(font_weight),
      text_align = VALUES(text_align),
      text_color = VALUES(text_color),
      background_color = VALUES(background_color),
      z_index = VALUES(z_index)
  `, {
    id,
    fieldId,
    surfaceId,
    xPercent: numberOrNull(body.xPercent ?? existing?.xPercent) ?? 50,
    yPercent: numberOrNull(body.yPercent ?? existing?.yPercent) ?? 50,
    widthPercent: numberOrNull(body.widthPercent ?? existing?.widthPercent) ?? 30,
    heightPercent: numberOrNull(body.heightPercent ?? existing?.heightPercent) ?? 10,
    rotationDegrees: numberOrNull(body.rotationDegrees ?? existing?.rotationDegrees) ?? 0,
    fontFamily: String(body.fontFamily ?? existing?.fontFamily ?? '').replace(/[;"<>]/g, '').slice(0, 120) || null,
    fontSizePercent: numberOrNull(body.fontSizePercent ?? existing?.fontSizePercent),
    fontWeight: body.fontWeight ?? existing?.fontWeight ?? null,
    textAlign: CUSTOMIZATION_TEXT_ALIGNMENTS.has(body.textAlign) ? body.textAlign : existing?.textAlign || 'center',
    textColor: body.textColor ?? existing?.textColor ?? null,
    backgroundColor: body.backgroundColor ?? existing?.backgroundColor ?? null,
    zIndex: Math.floor(Number(body.zIndex ?? existing?.zIndex ?? 1)) || 1
  });
  return customizationTemplateById(fieldRows[0].templateId);
}

async function updateCustomizationPlacement(placementId, body = {}) {
  const rows = await query('SELECT field_id AS fieldId, surface_id AS surfaceId FROM product_customization_placements WHERE id = :placementId LIMIT 1', { placementId });
  if (!rows[0]) {
    const error = new Error('Customization placement not found');
    error.statusCode = 404;
    throw error;
  }
  return saveCustomizationPlacement(rows[0].fieldId, { ...body, surfaceId: body.surfaceId || rows[0].surfaceId }, placementId);
}

async function deleteCustomizationPlacement(placementId) {
  const rows = await query(`
    SELECT f.template_id AS templateId
    FROM product_customization_placements p
    JOIN product_customization_fields f ON f.id = p.field_id
    WHERE p.id = :placementId
    LIMIT 1
  `, { placementId });
  if (!rows[0]) {
    const error = new Error('Customization placement not found');
    error.statusCode = 404;
    throw error;
  }
  await query('DELETE FROM product_customization_placements WHERE id = :placementId', { placementId });
  return customizationTemplateById(rows[0].templateId);
}

async function listSubscriptionPlans() {
  const rows = await query(`
    SELECT code AS id, name, monthly_price_jmd AS monthlyPrice, product_limit AS productLimit, features
    FROM subscription_plans
    WHERE is_active = TRUE
    ORDER BY monthly_price_jmd
  `);

  return rows.map((row) => ({
    ...row,
    monthlyPrice: Number(row.monthlyPrice || 0),
    productLimit: Number(row.productLimit || 0),
    features: asJsonArray(row.features)
  }));
}

async function listServices() {
  const rows = await query(`
    SELECT
      s.id,
      s.vendor_id AS vendorId,
      s.store_id AS storeId,
      s.name,
      s.category,
      s.price_jmd AS price,
      s.pricing_type AS pricingType,
      s.description,
      s.details,
      service_image.imageUrl,
      v.business_name AS vendor,
      st.slug AS storeSlug
    FROM services s
    JOIN vendors v ON v.id = s.vendor_id
    ${publicVendorSubscriptionJoin()}
    JOIN stores st ON st.id = s.store_id AND st.status NOT IN ('paused', 'suspended')
    ${primaryServiceImageJoin()}
    WHERE s.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
    ORDER BY s.name
  `);

  return rows.map((row) => ({
    ...row,
    vendor: row.vendor || 'Urban Market JA vendor',
    rating: 4.8,
    price: Number(row.price || 0),
    reviews: []
  }));
}

async function findServiceById(id) {
  const services = await listServices();
  return services.find((service) => service.id === id);
}

async function listFoods() {
  const rows = await query(`
    SELECT
      p.id,
      p.name,
      p.vendor_id AS vendorId,
      p.store_id AS storeId,
      v.business_name AS vendorName,
      st.slug AS storeSlug,
      st.name AS storeName,
      p.price_jmd AS price,
      p.description,
      p.delivery_day AS deliveryDay,
      product_image.imageUrl,
      customization_image.imageUrl AS customizationImageUrl
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    JOIN stores st ON st.id = p.store_id AND st.status NOT IN ('paused', 'suspended')
    ${primaryProductImageJoin()}
    ${primaryProductCustomizationImageJoin()}
    WHERE p.type = 'food'
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
    ORDER BY p.name
  `);

  return Promise.all(rows.map(async (row) => {
    const originalPrice = Number(row.price || 0);
    const discount = await bestDiscountForProduct(row, null, originalPrice);
    const price = discountedUnitPrice(originalPrice, discount);
    return {
      ...row,
      originalPrice,
      price,
      hasDiscount: price < originalPrice,
      discount: normalizeDiscount(discount),
      imageUrl: row.imageUrl || row.customizationImageUrl || ''
    };
  }));
}

async function listJobs(approvedOnly = true) {
  const rows = await query(`
    SELECT
      j.id,
      j.title,
      j.employer_name AS employer,
      j.category,
      j.location,
      j.salary_jmd AS salary,
      COALESCE(NULLIF(j.salary_min_jmd, 0), j.salary_jmd) AS salaryMin,
      COALESCE(NULLIF(j.salary_max_jmd, 0), NULLIF(j.salary_min_jmd, 0), j.salary_jmd) AS salaryMax,
      j.job_type AS type,
      j.created_at AS postedAt,
      j.deadline,
      j.description,
      j.responsibilities,
      j.requirements,
      j.contact,
      j.status
    FROM jobs j
    LEFT JOIN vendors v ON v.id = j.vendor_id
    ${latestVendorSubscriptionJoin('job_sub')}
    LEFT JOIN subscription_plans job_plan ON job_plan.id = job_sub.plan_id
    ${approvedOnly ? "WHERE j.status = 'published' AND (j.vendor_id IS NULL OR (v.status = 'active' AND v.registration_status = 'registered' AND job_sub.status = 'active' AND COALESCE(job_plan.code, 'starter') <> 'starter'))" : ''}
    ORDER BY j.created_at DESC
  `);

  return rows.map((row) => ({
    ...row,
    salary: Number(row.salary || 0),
    salaryMin: Number(row.salaryMin ?? row.salary ?? 0),
    salaryMax: Number(row.salaryMax ?? row.salaryMin ?? row.salary ?? 0),
    postedAt: dateOnly(row.postedAt),
    deadline: dateOnly(row.deadline),
    responsibilities: asJsonArray(row.responsibilities),
    requirements: asJsonArray(row.requirements),
    isApproved: row.status === 'published',
    status: row.status
  }));
}

async function findJobById(id) {
  const jobs = await listJobs(false);
  return jobs.find((job) => job.id === id);
}

async function findPublicJobById(id) {
  const jobs = await listJobs(true);
  return jobs.find((job) => job.id === id);
}

async function listUsers() {
  return query(`
    SELECT id, full_name AS name, COALESCE(email, phone) AS emailPhone, role, status, created_at AS createdAt
    FROM users
    ORDER BY created_at DESC
  `);
}

async function updateUserStatus(userId, status) {
  const normalizedStatus = ['active', 'disabled', 'pending'].includes(status) ? status : 'active';
  await query('UPDATE users SET status = :status WHERE id = :userId', { userId, status: normalizedStatus });
  const user = (await listUsers()).find((item) => item.id === userId);
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }
  return user;
}

async function promoteUserToAdmin(userId) {
  await query(`
    UPDATE users
    SET role = 'admin', status = 'active'
    WHERE id = :userId
  `, { userId });
  await query(`
    INSERT INTO admin_profiles (user_id, title)
    VALUES (:userId, 'Platform admin')
    ON DUPLICATE KEY UPDATE title = VALUES(title)
  `, { userId });

  const user = (await listUsers()).find((item) => item.id === userId);
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }
  return user;
}

async function findUserByEmailPhone(emailPhone, role = null) {
  const rows = await query(`
    SELECT id, full_name AS name, COALESCE(email, phone) AS emailPhone, role, status, password_hash AS passwordHash
    FROM users
    WHERE (email = :emailPhone OR phone = :emailPhone)
    ${role ? 'AND role = :role' : ''}
    ORDER BY FIELD(role, 'admin', 'vendor', 'customer')
    LIMIT 1
  `, { emailPhone, role });

  return rows[0] || null;
}

async function findUserById(id) {
  const rows = await query(`
    SELECT id, full_name AS name, COALESCE(email, phone) AS emailPhone, role, status, password_hash AS passwordHash
    FROM users
    WHERE id = :id
    LIMIT 1
  `, { id });
  return rows[0] || null;
}

async function profileForUser(userId) {
  const rows = await query(`
    SELECT
      u.id,
      u.full_name AS name,
      u.email,
      u.phone,
      COALESCE(u.email, u.phone) AS emailPhone,
      u.role,
      u.status,
      cp.parish,
      cp.default_delivery_address AS defaultDeliveryAddress,
      cp.preferences
    FROM users u
    LEFT JOIN customer_profiles cp ON cp.user_id = u.id
    WHERE u.id = :userId
    LIMIT 1
  `, { userId });
  const profile = rows[0];
  if (!profile) {
    const error = new Error('Profile not found');
    error.statusCode = 404;
    throw error;
  }
  return {
    ...profile,
    preferences: asJsonArray(profile.preferences)
  };
}

async function updateUserProfile(userId, body) {
  const current = await profileForUser(userId);
  const name = String(body.name || current.name || '').trim();
  const email = String(body.email ?? current.email ?? '').trim() || null;
  const phone = String(body.phone ?? current.phone ?? '').trim() || null;
  if (!name || (!email && !phone)) {
    const error = new Error('Profile requires a name and either email or phone');
    error.statusCode = 400;
    throw error;
  }

  await query(`
    UPDATE users
    SET full_name = :name, email = :email, phone = :phone
    WHERE id = :userId
  `, { userId, name, email, phone });

  if (current.role === 'customer') {
    await query(`
      INSERT INTO customer_profiles (user_id, parish, default_delivery_address)
      VALUES (:userId, :parish, :defaultDeliveryAddress)
      ON DUPLICATE KEY UPDATE parish = VALUES(parish), default_delivery_address = VALUES(default_delivery_address)
    `, {
      userId,
      parish: body.parish || current.parish || null,
      defaultDeliveryAddress: body.defaultDeliveryAddress || current.defaultDeliveryAddress || null
    });
  }

  return profileForUser(userId);
}

async function createUser({ name, emailPhone, role, passwordHash, businessName, businessLocation, storeType }) {
  const id = randomUUID();
  const isEmail = String(emailPhone).includes('@');
  await query(`
    INSERT INTO users (id, role, full_name, email, phone, password_hash)
    VALUES (:id, :role, :name, :email, :phone, :passwordHash)
  `, {
    id,
    role,
    name,
    email: isEmail ? emailPhone : null,
    phone: isEmail ? null : emailPhone,
    passwordHash: passwordHash || 'dev-placeholder-hash'
  });

  if (role === 'customer') {
    await query('INSERT INTO customer_profiles (user_id) VALUES (:id)', { id });
  }

  if (role === 'admin') {
    await query('INSERT INTO admin_profiles (user_id, title) VALUES (:id, :title)', { id, title: 'Platform admin' });
  }

  if (role === 'vendor') {
    const vendorId = randomUUID();
    const storeId = randomUUID();
    const vendorStoreType = normalizeStoreType(storeType);
    const slug = String(businessName || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `store-${Date.now()}`;
    await query(`
      INSERT INTO vendors (id, business_name, store_type, registration_status, status)
      VALUES (:vendorId, :businessName, :storeType, 'unregistered', 'active')
    `, { vendorId, businessName: businessName || `${name} Store`, storeType: vendorStoreType });
    await query(`
      INSERT INTO stores (id, vendor_id, name, slug, summary, location, address_line_1, status)
      VALUES (:storeId, :vendorId, :name, :slug, :summary, :location, :addressLine1, 'draft')
    `, {
      storeId,
      vendorId,
      name: businessName || `${name} Store`,
      slug,
      summary: `New Urban Market JA ${storeTypeLabel(vendorStoreType).toLowerCase()} store.`,
      location: businessLocation || null,
      addressLine1: businessLocation || null
    });
    await query('INSERT INTO vendor_users (vendor_id, user_id, vendor_role) VALUES (:vendorId, :id, :role)', {
      vendorId,
      id,
      role: 'owner'
    });
    await ensureVendorWallet(vendorId);
  }

  return { id, name, emailPhone, role, businessName, businessLocation, storeType: role === 'vendor' ? normalizeStoreType(storeType) : undefined };
}

async function vendorIdsForUser(userId) {
  const rows = await query('SELECT vendor_id AS vendorId FROM vendor_users WHERE user_id = :userId', { userId });
  return rows.map((row) => row.vendorId);
}

async function updateVendorStatus(vendorId, body) {
  const status = ['active', 'disabled', 'pending'].includes(body.status) ? body.status : null;
  const registrationStatus = ['registered', 'unregistered', 'expired'].includes(body.registrationStatus) ? body.registrationStatus : null;
  if (!status && !registrationStatus) {
    const error = new Error('Vendor status update requires status or registrationStatus');
    error.statusCode = 400;
    throw error;
  }

  await query(`
    UPDATE vendors
    SET
      status = COALESCE(:status, status),
      registration_status = COALESCE(:registrationStatus, registration_status)
    WHERE id = :vendorId
  `, { vendorId, status, registrationStatus });
  const vendor = (await listVendors(false)).find((item) => item.id === vendorId);
  if (!vendor) {
    const error = new Error('Vendor not found');
    error.statusCode = 404;
    throw error;
  }
  return vendor;
}

async function updateVendorSubscription(vendorId, body) {
  const vendors = await listVendors(false);
  const vendor = vendors.find((item) => item.id === vendorId);
  const planRows = await query(`
    SELECT id, code, name, monthly_price_jmd AS monthlyPrice
    FROM subscription_plans
    WHERE id = :planId OR code = :planId
    LIMIT 1
  `, { planId: body.planId });
  const plan = planRows[0];
  const status = ['trial', 'active', 'past_due', 'cancelled'].includes(body.status) ? body.status : 'active';

  if (!vendor) {
    const error = new Error('Vendor subscription update requires a valid vendor');
    error.statusCode = 400;
    throw error;
  }

  if (!plan) {
    const error = new Error('Subscription plan not found. Confirm subscription_plans contains starter, growth, and pro rows.');
    error.statusCode = 400;
    throw error;
  }

  const currentPeriodEnd = body.currentPeriodEnd || (() => {
    const end = new Date();
    end.setMonth(end.getMonth() + 1);
    return end.toISOString().split('T')[0];
  })();

  await transaction(async (tx) => {
    await tx.query(`
      UPDATE vendor_subscriptions
      SET status = 'cancelled'
      WHERE vendor_id = :vendorId AND status IN ('trial', 'active', 'past_due')
    `, { vendorId });
    await tx.query(`
      INSERT INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, last_payment_at)
      VALUES (:vendorId, :planId, :status, CURRENT_DATE, :currentPeriodEnd, CASE WHEN :status = 'active' THEN CURRENT_TIMESTAMP ELSE NULL END)
    `, {
      vendorId,
      planId: plan.id,
      status,
      currentPeriodEnd
    });
  });

  return (await listVendors(false)).find((item) => item.id === vendorId);
}

async function defaultVendorIdForUser(userId) {
  const vendorIds = await vendorIdsForUser(userId);
  return vendorIds[0] || null;
}

async function findDefaultUser(role = 'customer') {
  const rows = await query(`
    SELECT id, full_name AS name, COALESCE(email, phone) AS emailPhone, role
    FROM users
    WHERE role = :role
    ORDER BY created_at
    LIMIT 1
  `, { role });
  return rows[0] || null;
}

async function activeCartForUser(customerUserId) {
  let rows = await query(`
    SELECT id, customer_user_id AS customerUserId, status, created_at AS createdAt, updated_at AS updatedAt
    FROM carts
    WHERE customer_user_id = :customerUserId AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `, { customerUserId });

  if (!rows[0]) {
    const id = randomUUID();
    await query('INSERT INTO carts (id, customer_user_id, status) VALUES (:id, :customerUserId, "active")', { id, customerUserId });
    rows = await query(`
      SELECT id, customer_user_id AS customerUserId, status, created_at AS createdAt, updated_at AS updatedAt
      FROM carts
      WHERE id = :id
    `, { id });
  }

  return rows[0];
}

function isEmptyCustomizationValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function hasCustomerImageValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value !== 'object') return false;
  return Boolean(value.imageDataBase64 || value.url || value.imageUrl);
}

function sanitizedImageValueJson(value, field, url = '') {
  const source = value && typeof value === 'object' ? value : {};
  const imageName = String(source.imageName || source.name || source.label || field.label || 'custom image').trim();
  const normalizedUrl = url || source.url || source.imageUrl || '';
  return {
    url: normalizedUrl,
    imageUrl: normalizedUrl,
    imageName,
    imageMimeType: source.imageMimeType || source.mimeType || null,
    imageSizeBytes: Number(source.imageSizeBytes || source.sizeBytes || 0) || null,
    reviewStatus: source.reviewStatus || 'pending_vendor_review',
    uploadedAt: source.uploadedAt || new Date().toISOString()
  };
}

function isAllowedCustomizationImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  return url.startsWith('uploads/customization-media/')
    || url.startsWith('/api/uploads/customization-media/');
}

function normalizeCustomizationImageUrl(value) {
  return normalizeStoredMediaUrl(value);
}

async function saveCustomerCustomizationImage(productId, field, value) {
  if (!hasCustomerImageValue(value)) return null;
  if (typeof value === 'string') {
    const url = normalizeCustomizationImageUrl(value);
    if (!isAllowedCustomizationImageUrl(url)) {
      const error = new Error(`${field.label} must be uploaded as an image file`);
      error.statusCode = 400;
      throw error;
    }
    return sanitizedImageValueJson({ imageName: path.basename(url), url }, field, url);
  }

  const existingUrl = normalizeCustomizationImageUrl(value.url || value.imageUrl || '');
  if (!value.imageDataBase64) {
    if (existingUrl && !isAllowedCustomizationImageUrl(existingUrl)) {
      const error = new Error(`${field.label} must be uploaded as an image file`);
      error.statusCode = 400;
      throw error;
    }
    return existingUrl ? sanitizedImageValueJson(value, field, existingUrl) : null;
  }

  const uploadId = cleanFileName(`custom-${productId}-${field.fieldKey}-${randomUUID()}`, `custom-${randomUUID()}`);
  const url = await saveCustomizationImageUpload(uploadId, value);
  return sanitizedImageValueJson(value, field, url);
}

function stripCustomerImageData(value) {
  if (!value || typeof value !== 'object') return value;
  const {
    imageDataBase64,
    previewUrl,
    localPreviewUrl,
    ...rest
  } = value;
  return rest;
}

function customizationPreviewsWithUploadedImages(previews, customizations) {
  const imageByFieldKey = new Map(
    (customizations || [])
      .filter((item) => item.fieldType === 'image' && item.valueJson?.url)
      .map((item) => [item.fieldKey, item.valueJson])
  );
  if (!imageByFieldKey.size) {
    return previews.map((preview) => {
      const rawValues = preview.previewJson?.values && typeof preview.previewJson.values === 'object'
        ? preview.previewJson.values
        : {};
      const previewJson = preview.previewJson && typeof preview.previewJson === 'object'
        ? {
            ...preview.previewJson,
            values: Object.fromEntries(Object.entries(rawValues).map(([key, value]) => [key, stripCustomerImageData(value)]))
          }
        : preview.previewJson;
      return { ...preview, previewJson };
    });
  }

  return previews.map((preview) => {
    const previewJson = preview.previewJson && typeof preview.previewJson === 'object'
      ? { ...preview.previewJson }
      : preview.previewJson;
    if (!previewJson || typeof previewJson !== 'object') return preview;

    const values = previewJson.values && typeof previewJson.values === 'object'
      ? { ...previewJson.values }
      : {};
    for (const [fieldKey, image] of imageByFieldKey.entries()) {
      values[fieldKey] = stripCustomerImageData(image);
    }

    const fields = Array.isArray(previewJson.fields)
      ? previewJson.fields.map((field) => {
          const image = imageByFieldKey.get(field?.fieldKey);
          return image
            ? {
                ...field,
                fieldType: 'image',
                value: image.imageName || 'Uploaded image',
                imageUrl: image.url,
                reviewStatus: image.reviewStatus || 'pending_vendor_review'
              }
            : field;
        })
      : previewJson.fields;

    return {
      ...preview,
      previewJson: {
        ...previewJson,
        values,
        fields
      }
    };
  });
}

async function recordCustomizationAudit(entry, executor = query) {
  try {
    const run = typeof executor === 'function'
      ? executor
      : executor && typeof executor.query === 'function'
        ? executor.query.bind(executor)
        : query;
    await run(`
      INSERT INTO customization_audit_logs (id, order_id, order_item_id, product_id, vendor_id, actor_user_id, actor_role, action, details)
      VALUES (:id, :orderId, :orderItemId, :productId, :vendorId, :actorUserId, :actorRole, :action, :details)
    `, {
      id: randomUUID(),
      orderId: entry.orderId || null,
      orderItemId: entry.orderItemId || null,
      productId: entry.productId || null,
      vendorId: entry.vendorId || null,
      actorUserId: entry.actorUserId || null,
      actorRole: entry.actorRole || null,
      action: entry.action,
      details: entry.details === undefined ? null : JSON.stringify(entry.details)
    });
  } catch (error) {
    console.warn('Customization audit logging failed', error.message);
  }
}

function normalizeStoredCustomization(row) {
  return {
    id: row.id || null,
    cartId: row.cartId || null,
    productId: row.productId || null,
    customizationSignature: row.customizationSignature || '',
    orderItemId: row.orderItemId || null,
    fieldId: row.fieldId || null,
    fieldKey: row.fieldKey,
    fieldLabel: row.fieldLabel,
    label: row.fieldLabel,
    fieldType: row.fieldType,
    valueText: row.valueText || '',
    valueJson: safeParseJson(row.valueJson, null),
    priceDeltaJmd: Number(row.priceDeltaJmd || 0),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function customizationSummaryLine(customization) {
  const label = customization.fieldLabel || customization.label || customization.fieldKey || 'Custom option';
  const value = customization.valueText || '';
  const priceDelta = Number(customization.priceDeltaJmd || 0);
  const suffix = priceDelta > 0 ? ` (+JMD ${priceDelta.toLocaleString()})` : '';
  return `${label}: ${value}${suffix}`;
}

function normalizeStoredPreview(row) {
  return {
    id: row.id || null,
    cartId: row.cartId || null,
    productId: row.productId || null,
    customizationSignature: row.customizationSignature || '',
    orderItemId: row.orderItemId || null,
    surfaceKey: row.surfaceKey,
    previewImageUrl: row.previewImageUrl || null,
    previewJson: safeParseJson(row.previewJson, null),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

async function validateProductCustomization(productId, body = {}) {
  const productRows = await query(`
    SELECT p.id
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    JOIN stores st ON st.id = p.store_id AND st.status NOT IN ('paused', 'suspended')
    WHERE p.id = :productId
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
    LIMIT 1
  `, { productId });
  if (!productRows[0]) {
    const error = new Error('Product is not available for customization');
    error.statusCode = 404;
    throw error;
  }
  const template = await customizationTemplateByProductId(productId, { publicOnly: true });
  const values = customizationValuesMap(body);
  const previews = normalizeCustomizationPreviews(body);
  if (!template) {
    if (values.size || previews.length) {
      const error = new Error('This product is not set up for customization');
      error.statusCode = 400;
      throw error;
    }
    return {
      productId,
      isCustomizable: false,
      templateId: null,
      customizations: [],
      previews: [],
      customizationSignature: '',
      addOnTotalJmd: 0
    };
  }

  const customizations = [];
  for (const field of template.fields.filter((item) => item.status === 'active')) {
    const record = values.get(field.id) || values.get(field.fieldKey);
    let value = customizationValueFromRecord(record);
    if (isEmptyCustomizationValue(value) && !isEmptyCustomizationValue(field.defaultValue)) {
      value = field.defaultValue;
    }

    if (isEmptyCustomizationValue(value)) {
      if (field.isRequired) {
        const error = new Error(`${field.label} is required`);
        error.statusCode = 400;
        throw error;
      }
      continue;
    }

    let valueText = customizationValueText(value);
    let valueJson = null;
    let priceDeltaJmd = Number(field.priceDeltaJmd || 0);

    if (field.fieldType === 'text') {
      valueText = valueText.trim();
      if (field.minLength !== null && valueText.length < field.minLength) {
        const error = new Error(`${field.label} must be at least ${field.minLength} characters`);
        error.statusCode = 400;
        throw error;
      }
      if (field.maxLength !== null && valueText.length > field.maxLength) {
        const error = new Error(`${field.label} must be ${field.maxLength} characters or fewer`);
        error.statusCode = 400;
        throw error;
      }
      const maxLength = field.maxLength === null ? 120 : field.maxLength;
      if (valueText.length > maxLength) {
        const error = new Error(`${field.label} must be ${maxLength} characters or fewer`);
        error.statusCode = 400;
        throw error;
      }
    } else if (field.fieldType === 'number') {
      const number = Number(valueText);
      if (!Number.isFinite(number)) {
        const error = new Error(`${field.label} must be a number`);
        error.statusCode = 400;
        throw error;
      }
      if (field.minValue !== null && number < field.minValue) {
        const error = new Error(`${field.label} must be at least ${field.minValue}`);
        error.statusCode = 400;
        throw error;
      }
      if (field.maxValue !== null && number > field.maxValue) {
        const error = new Error(`${field.label} must be no more than ${field.maxValue}`);
        error.statusCode = 400;
        throw error;
      }
      valueText = String(number);
      valueJson = { value: number };
    } else if (field.fieldType === 'color') {
      valueText = valueText.trim();
      if (!/^#[0-9a-f]{6}$/i.test(valueText)) {
        const error = new Error(`${field.label} must be a valid color`);
        error.statusCode = 400;
        throw error;
      }
      if (valueText.length > 32) {
        const error = new Error(`${field.label} color value is too long`);
        error.statusCode = 400;
        throw error;
      }
    } else if (field.fieldType === 'select') {
      const selectedValue = customizationKey(
        typeof value === 'object' ? value.optionValue || value.value || value.label : value,
        'option'
      );
      const option = field.options.find((item) => item.status === 'active' && item.optionValue === selectedValue);
      if (!option) {
        const error = new Error(`${field.label} must use one of the available options`);
        error.statusCode = 400;
        throw error;
      }
      valueText = option.label;
      valueJson = { optionValue: option.optionValue, label: option.label, swatchColor: option.swatchColor || null };
      priceDeltaJmd += Number(option.priceDeltaJmd || 0);
    } else if (field.fieldType === 'checkbox') {
      const checked = value === true || value === 'true' || value === '1' || value === 1 || value === 'yes';
      if (field.isRequired && !checked) {
        const error = new Error(`${field.label} must be selected`);
        error.statusCode = 400;
        throw error;
      }
      valueText = checked ? 'Yes' : 'No';
      valueJson = { checked };
      if (!checked) {
        priceDeltaJmd = 0;
      }
    } else if (field.fieldType === 'image') {
      const imageValue = await saveCustomerCustomizationImage(productId, field, value);
      if (!imageValue) {
        if (field.isRequired) {
          const error = new Error(`${field.label} image is required`);
          error.statusCode = 400;
          throw error;
        }
        continue;
      }
      valueText = imageValue.imageName || imageValue.url || 'Uploaded image';
      valueJson = imageValue;
    }

    customizations.push({
      fieldId: field.id,
      fieldKey: field.fieldKey,
      fieldLabel: field.label,
      fieldType: field.fieldType,
      valueText,
      valueJson,
      priceDeltaJmd
    });
  }

  const normalizedPreviews = customizationPreviewsWithUploadedImages(previews, customizations);
  const signature = customizationSignature(customizations, normalizedPreviews);
  return {
    productId,
    isCustomizable: true,
    templateId: template.id,
    customizations,
    previews: normalizedPreviews,
    customizationSignature: signature,
    addOnTotalJmd: customizations.reduce((sum, item) => sum + Number(item.priceDeltaJmd || 0), 0)
  };
}

async function saveCartItemCustomizationRows(cartId, productId, customizationSignatureValue, validation) {
  await query(`
    DELETE FROM cart_item_customizations
    WHERE cart_id = :cartId AND product_id = :productId AND customization_signature = :customizationSignature
  `, { cartId, productId, customizationSignature: customizationSignatureValue });
  await query(`
    DELETE FROM cart_item_customization_previews
    WHERE cart_id = :cartId AND product_id = :productId AND customization_signature = :customizationSignature
  `, { cartId, productId, customizationSignature: customizationSignatureValue });

  for (const item of validation.customizations || []) {
    await query(`
      INSERT INTO cart_item_customizations (id, cart_id, product_id, customization_signature, field_id, field_key, field_label, field_type, value_text, value_json, price_delta_jmd)
      VALUES (:id, :cartId, :productId, :customizationSignature, :fieldId, :fieldKey, :fieldLabel, :fieldType, :valueText, :valueJson, :priceDeltaJmd)
    `, {
      id: randomUUID(),
      cartId,
      productId,
      customizationSignature: customizationSignatureValue,
      fieldId: item.fieldId || null,
      fieldKey: item.fieldKey,
      fieldLabel: item.fieldLabel,
      fieldType: item.fieldType,
      valueText: item.valueText || null,
      valueJson: item.valueJson === undefined || item.valueJson === null ? null : JSON.stringify(item.valueJson),
      priceDeltaJmd: nonNegativeInt(item.priceDeltaJmd, 0)
    });
  }

  for (const preview of validation.previews || []) {
    await query(`
      INSERT INTO cart_item_customization_previews (id, cart_id, product_id, customization_signature, surface_key, preview_image_url, preview_json)
      VALUES (:id, :cartId, :productId, :customizationSignature, :surfaceKey, :previewImageUrl, :previewJson)
    `, {
      id: randomUUID(),
      cartId,
      productId,
      customizationSignature: customizationSignatureValue,
      surfaceKey: preview.surfaceKey,
      previewImageUrl: preview.previewImageUrl || null,
      previewJson: preview.previewJson === undefined || preview.previewJson === null ? null : JSON.stringify(preview.previewJson)
    });
  }
}

async function listCustomizationUploads() {
  const rows = await query(`
    SELECT
      'order' AS sourceType,
      oic.id,
      oi.order_id AS orderId,
      NULL AS cartId,
      oi.product_id AS productId,
      oi.item_name AS productName,
      oi.vendor_id AS vendorId,
      v.business_name AS vendorName,
      oic.field_key AS fieldKey,
      oic.field_label AS fieldLabel,
      oic.value_text AS valueText,
      oic.value_json AS valueJson,
      oic.created_at AS createdAt
    FROM order_item_customizations oic
    JOIN order_items oi ON oi.id = oic.order_item_id
    JOIN vendors v ON v.id = oi.vendor_id
    WHERE oic.field_type = 'image'
    UNION ALL
    SELECT
      'cart' AS sourceType,
      cic.id,
      NULL AS orderId,
      cic.cart_id AS cartId,
      cic.product_id AS productId,
      p.name AS productName,
      ci.vendor_id AS vendorId,
      v.business_name AS vendorName,
      cic.field_key AS fieldKey,
      cic.field_label AS fieldLabel,
      cic.value_text AS valueText,
      cic.value_json AS valueJson,
      cic.created_at AS createdAt
    FROM cart_item_customizations cic
    JOIN cart_items ci ON ci.cart_id = cic.cart_id AND ci.product_id = cic.product_id AND ci.customization_signature = cic.customization_signature
    JOIN products p ON p.id = cic.product_id
    JOIN vendors v ON v.id = ci.vendor_id
    WHERE cic.field_type = 'image'
    ORDER BY createdAt DESC
  `);
  return rows.map((row) => ({
    ...row,
    valueJson: safeParseJson(row.valueJson, null)
  }));
}

async function cartItemsForCart(cartId) {
  const rows = await query(`
    SELECT
      ci.id AS cartItemId,
      ci.cart_id AS cartId,
      c.customer_user_id AS customerUserId,
      ci.product_id AS productId,
      p.name,
      ci.vendor_id AS vendorId,
      v.business_name AS vendorName,
      ci.store_id AS storeId,
      st.slug AS vendorSlug,
      ci.unit_price_jmd AS price,
      p.stock_quantity AS stockQuantity,
      p.delivery_day AS deliveryDay,
      ci.quantity AS qty,
      ci.customization_signature AS customizationSignature
    FROM cart_items ci
    JOIN carts c ON c.id = ci.cart_id
    JOIN products p ON p.id = ci.product_id
    JOIN vendors v ON v.id = ci.vendor_id
    ${publicVendorSubscriptionJoin()}
    JOIN stores st ON st.id = ci.store_id AND st.status NOT IN ('paused', 'suspended')
    WHERE ci.cart_id = :cartId
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
    ORDER BY ci.created_at
  `, { cartId });
  const [customizationRows, previewRows] = rows.length ? await Promise.all([
    query(`
      SELECT id, product_id AS productId, customization_signature AS customizationSignature, field_id AS fieldId, field_key AS fieldKey, field_label AS fieldLabel, field_type AS fieldType, value_text AS valueText, value_json AS valueJson, price_delta_jmd AS priceDeltaJmd, created_at AS createdAt, updated_at AS updatedAt
      FROM cart_item_customizations
      WHERE cart_id = :cartId
      ORDER BY created_at
    `, { cartId }),
    query(`
      SELECT id, product_id AS productId, customization_signature AS customizationSignature, surface_key AS surfaceKey, preview_image_url AS previewImageUrl, preview_json AS previewJson, created_at AS createdAt, updated_at AS updatedAt
      FROM cart_item_customization_previews
      WHERE cart_id = :cartId
      ORDER BY created_at
    `, { cartId })
  ]) : [[], []];
  const customizationsByItem = new Map();
  for (const row of customizationRows) {
    const key = `${row.productId}:${row.customizationSignature || ''}`;
    const list = customizationsByItem.get(key) || [];
    list.push(normalizeStoredCustomization(row));
    customizationsByItem.set(key, list);
  }
  const previewsByItem = new Map();
  for (const row of previewRows) {
    const key = `${row.productId}:${row.customizationSignature || ''}`;
    const list = previewsByItem.get(key) || [];
    list.push(normalizeStoredPreview(row));
    previewsByItem.set(key, list);
  }

  return Promise.all(rows.map(async (item) => {
    const customizationSignatureValue = item.customizationSignature || '';
    const key = `${item.productId}:${customizationSignatureValue}`;
    const customizations = customizationsByItem.get(key) || [];
    const customizationPreviews = previewsByItem.get(key) || [];
    const originalPrice = Number(item.price || 0);
    const discount = await bestDiscountForProduct({
      id: item.productId,
      vendorId: item.vendorId,
      storeId: item.storeId
    }, item.customerUserId, originalPrice, query, item.cartId);
    const customizationAddOnTotal = customizations.reduce((sum, customization) => sum + Number(customization.priceDeltaJmd || 0), 0);
    return {
      ...item,
      originalPrice: originalPrice + customizationAddOnTotal,
      price: discountedUnitPrice(originalPrice, discount) + customizationAddOnTotal,
      discount: normalizeDiscount(discount),
      qty: Number(item.qty || 0),
      stockQuantity: Number(item.stockQuantity || 0),
      customizationSignature: customizationSignatureValue,
      customizations,
      customizationPreviews,
      customizationAddOnTotal,
      customizationSummary: customizations.map(customizationSummaryLine)
    };
  }));
}

async function cartForUser(customerUserId) {
  const cart = await activeCartForUser(customerUserId);
  const items = await cartItemsForCart(cart.id);
  return {
    ...cart,
    items,
    count: items.reduce((sum, item) => sum + item.qty, 0),
    total: items.reduce((sum, item) => sum + item.price * item.qty, 0)
  };
}

async function addCartItem(customerUserId, body = {}) {
  const { productId, qty = 1 } = body;
  const cart = await activeCartForUser(customerUserId);
  const rows = await query(`
    SELECT p.id, p.vendor_id AS vendorId, p.store_id AS storeId, p.price_jmd AS price, p.stock_quantity AS stockQuantity
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    JOIN stores st ON st.id = p.store_id AND st.status NOT IN ('paused', 'suspended')
    WHERE p.id = :productId
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
    LIMIT 1
  `, { productId });
  const product = rows[0];
  if (!product) {
    const error = new Error('Product is not available for cart');
    error.statusCode = 404;
    throw error;
  }
  const validation = await validateProductCustomization(productId, body);
  const customizationSignatureValue = validation.customizationSignature || '';
  const requestedQty = Math.max(1, Math.floor(Number(qty) || 1));
  const currentRows = await query(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity
    FROM cart_items
    WHERE cart_id = :cartId AND product_id = :productId
  `, { cartId: cart.id, productId });
  const currentQty = Number(currentRows[0]?.quantity || 0);
  if (Number(product.stockQuantity || 0) < currentQty + requestedQty) {
    const error = new Error('Not enough stock is available for this product');
    error.statusCode = 409;
    throw error;
  }
  await query(`
    INSERT INTO cart_items (cart_id, product_id, vendor_id, store_id, quantity, unit_price_jmd, customization_signature)
    VALUES (:cartId, :productId, :vendorId, :storeId, :qty, :price, :customizationSignature)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), unit_price_jmd = VALUES(unit_price_jmd)
  `, {
    cartId: cart.id,
    productId,
    vendorId: product.vendorId,
    storeId: product.storeId,
    qty: requestedQty,
    price: Number(product.price || 0),
    customizationSignature: customizationSignatureValue
  });
  await saveCartItemCustomizationRows(cart.id, productId, customizationSignatureValue, validation);
  return cartForUser(customerUserId);
}

async function updateCartItem(customerUserId, productId, qty, customizationSignatureValue = '') {
  const cart = await activeCartForUser(customerUserId);
  const quantity = Math.max(1, Math.floor(Number(qty) || 1));
  const signature = String(customizationSignatureValue || '');
  const rows = await query(`
    SELECT p.stock_quantity AS stockQuantity
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    JOIN stores st ON st.id = p.store_id AND st.status NOT IN ('paused', 'suspended')
    WHERE p.id = :productId
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
    LIMIT 1
  `, { productId });
  if (!rows[0]) {
    const error = new Error('Product is not available for cart');
    error.statusCode = 404;
    throw error;
  }
  const otherRows = await query(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity
    FROM cart_items
    WHERE cart_id = :cartId AND product_id = :productId AND customization_signature <> :customizationSignature
  `, { cartId: cart.id, productId, customizationSignature: signature });
  if (Number(rows[0].stockQuantity || 0) < Number(otherRows[0]?.quantity || 0) + quantity) {
    const error = new Error('Not enough stock is available for this product');
    error.statusCode = 409;
    throw error;
  }
  const result = await query(`
    UPDATE cart_items
    SET quantity = :quantity
    WHERE cart_id = :cartId AND product_id = :productId AND customization_signature = :customizationSignature
  `, { cartId: cart.id, productId, quantity, customizationSignature: signature });
  if (result.affectedRows !== 1) {
    const error = new Error('Cart item not found');
    error.statusCode = 404;
    throw error;
  }
  return cartForUser(customerUserId);
}

async function removeCartItem(customerUserId, productId, customizationSignatureValue = '') {
  const cart = await activeCartForUser(customerUserId);
  await query('DELETE FROM cart_items WHERE cart_id = :cartId AND product_id = :productId AND customization_signature = :customizationSignature', {
    cartId: cart.id,
    productId,
    customizationSignature: String(customizationSignatureValue || '')
  });
  return cartForUser(customerUserId);
}

async function clearCart(customerUserId) {
  const cart = await activeCartForUser(customerUserId);
  await query('DELETE FROM cart_items WHERE cart_id = :cartId', { cartId: cart.id });
  return cartForUser(customerUserId);
}

async function bestDiscountForProduct(product, customerUserId, unitPrice, runner = query, cartId = null) {
  if (!product?.id || !product.vendorId) return null;
  const rows = await runner(`
    SELECT DISTINCT
      d.id,
      d.name,
      d.code,
      d.discount_type AS discountType,
      d.amount,
      d.scope,
      CASE WHEN dco.id IS NULL THEN 0 ELSE 1 END AS cartOffer
    FROM discounts d
    LEFT JOIN discount_products dp ON dp.discount_id = d.id
    LEFT JOIN discount_cart_offers dco
      ON dco.discount_id = d.id
      AND dco.cart_id = :cartId
      AND dco.vendor_id = :vendorId
      AND dco.status = 'active'
      AND (dco.expires_at IS NULL OR dco.expires_at >= NOW())
    WHERE d.vendor_id = :vendorId
      AND d.status = 'active'
      AND (d.store_id IS NULL OR d.store_id = :storeId)
      AND (d.customer_user_id IS NULL OR d.customer_user_id = :customerUserId)
      AND (d.starts_at IS NULL OR d.starts_at <= NOW())
      AND (d.ends_at IS NULL OR d.ends_at >= NOW())
      AND (
        d.scope = 'store'
        OR (d.scope = 'customer' AND d.customer_user_id = :customerUserId)
        OR (d.scope = 'product' AND dp.product_id = :productId)
        OR dco.id IS NOT NULL
      )
  `, {
    vendorId: product.vendorId,
    storeId: product.storeId || null,
    customerUserId: customerUserId || null,
    productId: product.id,
    cartId
  });

  return rows.reduce((best, discount) => {
    if (!best) return discount;
    return discountedUnitPrice(unitPrice, discount) < discountedUnitPrice(unitPrice, best) ? discount : best;
  }, null);
}

function discountedUnitPrice(unitPrice, discount) {
  const price = Math.max(0, Number(unitPrice) || 0);
  if (!discount) return price;
  const amount = Math.max(0, Number(discount.amount) || 0);
  if (discount.discountType === 'fixed') {
    return Math.max(0, price - amount);
  }
  return Math.max(0, Math.round(price * (1 - Math.min(100, amount) / 100)));
}

function normalizeDiscount(discount) {
  if (!discount) return null;
  return {
    ...discount,
    amount: Number(discount.amount || 0),
    cartOffer: Boolean(discount.cartOffer)
  };
}

async function ensureVendorWallet(vendorId, runner = query) {
  if (!vendorId) return null;
  await runner(`
    INSERT IGNORE INTO vendor_wallet_accounts (vendor_id)
    VALUES (:vendorId)
  `, { vendorId });
  const rows = await runner(`
    SELECT
      vendor_id AS vendorId,
      available_coins AS availableCoins,
      held_coins AS heldCoins,
      pending_checkout_coins AS pendingCheckoutCoins,
      lifetime_earned_coins AS lifetimeEarnedCoins,
      updated_at AS updatedAt
    FROM vendor_wallet_accounts
    WHERE vendor_id = :vendorId
    LIMIT 1
  `, { vendorId });
  return normalizeWallet(rows[0]);
}

async function recordAuditEntry(runner, { adminUserId = null, action, entityType, entityId = null, details = {} }) {
  await runner(`
    INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, details)
    VALUES (:adminUserId, :action, :entityType, :entityId, :details)
  `, {
    adminUserId,
    action,
    entityType,
    entityId,
    details: JSON.stringify(details)
  });
}

function normalizeWallet(wallet) {
  if (!wallet) return null;
  return {
    ...wallet,
    availableCoins: Number(wallet.availableCoins || 0),
    heldCoins: Number(wallet.heldCoins || 0),
    pendingCheckoutCoins: Number(wallet.pendingCheckoutCoins || 0),
    lifetimeEarnedCoins: Number(wallet.lifetimeEarnedCoins || 0)
  };
}

async function recordWalletEntry(runner, entry) {
  const amount = coinsFromJmd(entry.amountCoins ?? entry.amountJmd);
  if (!amount) return null;
  const id = entry.id || randomUUID();
  await runner(`
    INSERT INTO vendor_wallet_ledger (
      id,
      vendor_id,
      order_id,
      order_item_id,
      service_booking_id,
      checkout_request_id,
      product_id,
      payment_session_id,
      entry_type,
      balance_bucket,
      direction,
      amount_coins,
      amount_jmd,
      description
    )
    VALUES (
      :id,
      :vendorId,
      :orderId,
      :orderItemId,
      :serviceBookingId,
      :checkoutRequestId,
      :productId,
      :paymentSessionId,
      :entryType,
      :balanceBucket,
      :direction,
      :amountCoins,
      :amountJmd,
      :description
    )
  `, {
    id,
    vendorId: entry.vendorId,
    orderId: entry.orderId || null,
    orderItemId: entry.orderItemId || null,
    serviceBookingId: entry.serviceBookingId || null,
    checkoutRequestId: entry.checkoutRequestId || null,
    productId: entry.productId || null,
    paymentSessionId: entry.paymentSessionId || null,
    entryType: entry.entryType,
    balanceBucket: entry.balanceBucket,
    direction: entry.direction,
    amountCoins: amount,
    amountJmd: Math.max(1, Math.round(Number(entry.amountJmd ?? amount * COIN_JMD_RATE))),
    description: entry.description || null
  });
  await recordAuditEntry(runner, {
    action: `wallet_${entry.entryType}`,
    entityType: 'vendor_wallet_ledger',
    entityId: id,
    details: {
      vendorId: entry.vendorId,
      orderId: entry.orderId || null,
      orderItemId: entry.orderItemId || null,
      serviceBookingId: entry.serviceBookingId || null,
      checkoutRequestId: entry.checkoutRequestId || null,
      productId: entry.productId || null,
      paymentSessionId: entry.paymentSessionId || null,
      balanceBucket: entry.balanceBucket,
      direction: entry.direction,
      amountCoins: amount,
      amountJmd: Math.max(1, Math.round(Number(entry.amountJmd ?? amount * COIN_JMD_RATE))),
      description: entry.description || null
    }
  });
  return id;
}

async function creditOrderHold(runner, orderId, item, paymentSessionId = null) {
  const amount = coinsFromJmd(item.price * item.qty);
  if (!amount) return;
  const orderItemId = item.orderItemId || item.id || null;
  if (orderItemId) {
    const existingRows = await runner(`
      SELECT id
      FROM vendor_wallet_ledger
      WHERE order_item_id = :orderItemId AND entry_type = 'order_hold'
      LIMIT 1
    `, { orderItemId });
    if (existingRows[0]) return;
  }
  await ensureVendorWallet(item.vendorId, runner);
  await runner(`
    UPDATE vendor_wallet_accounts
    SET held_coins = held_coins + :amount, lifetime_earned_coins = lifetime_earned_coins + :amount
    WHERE vendor_id = :vendorId
  `, { vendorId: item.vendorId, amount });
  await recordWalletEntry(runner, {
    vendorId: item.vendorId,
    orderId,
    orderItemId,
    productId: item.productId,
    paymentSessionId,
    entryType: 'order_hold',
    balanceBucket: 'held',
    direction: 'credit',
    amountCoins: amount,
    amountJmd: item.price * item.qty,
    description: 'Customer payment converted to held Market Credits.'
  });
}

async function releaseEligibleOrderFunds(orderId, vendorId = null) {
  return transaction(async (tx) => {
    const rows = await tx.query(`
      SELECT id, order_id AS orderId, product_id AS productId, vendor_id AS vendorId, line_total_jmd AS lineTotal
      FROM order_items
      WHERE order_id = :orderId
        ${vendorId ? 'AND vendor_id = :vendorId' : ''}
        AND fulfillment_status = 'fulfilled'
        AND customer_received_at IS NOT NULL
        AND funds_released_at IS NULL
      FOR UPDATE
    `, { orderId, vendorId });

    for (const item of rows) {
      const amount = coinsFromJmd(item.lineTotal);
      if (!amount) continue;
      await ensureVendorWallet(item.vendorId, tx.query);
      const result = await tx.query(`
        UPDATE order_items
        SET funds_released_at = CURRENT_TIMESTAMP
        WHERE id = :orderItemId AND funds_released_at IS NULL
      `, { orderItemId: item.id });
      if (result.affectedRows !== 1) continue;
      await tx.query(`
        UPDATE vendor_wallet_accounts
        SET held_coins = GREATEST(0, held_coins - :amount), available_coins = available_coins + :amount
        WHERE vendor_id = :vendorId
      `, { vendorId: item.vendorId, amount });
      await recordWalletEntry(tx.query, {
        vendorId: item.vendorId,
        orderId,
        orderItemId: item.id,
        productId: item.productId,
        entryType: 'hold_release',
        balanceBucket: 'held',
        direction: 'debit',
        amountCoins: amount,
        amountJmd: item.lineTotal,
        description: 'Held credits released after fulfillment and customer receipt confirmation.'
      });
      await recordWalletEntry(tx.query, {
        vendorId: item.vendorId,
        orderId,
        orderItemId: item.id,
        productId: item.productId,
        entryType: 'hold_release',
        balanceBucket: 'available',
        direction: 'credit',
        amountCoins: amount,
        amountJmd: item.lineTotal,
        description: 'Credits are available for site purchases or checkout request.'
      });
    }

    await tx.query(`
      UPDATE orders o
      SET o.status = 'completed'
      WHERE o.id = :orderId
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi
          WHERE oi.order_id = o.id AND oi.funds_released_at IS NULL
        )
    `, { orderId });

    return rows.length;
  });
}

async function creditServiceBookingHold(runner, booking, paymentSessionId = null) {
  const amount = coinsFromJmd(booking.totalJmd ?? booking.total_jmd ?? booking.total);
  if (!amount) return;
  const bookingId = booking.id || booking.serviceBookingId;
  const vendorId = booking.vendorId ?? booking.vendor_id;
  if (!bookingId || !vendorId) return;
  const existingRows = await runner(`
    SELECT id
    FROM vendor_wallet_ledger
    WHERE service_booking_id = :bookingId AND entry_type = 'service_booking_hold'
    LIMIT 1
  `, { bookingId });
  if (existingRows[0]) return;

  await ensureVendorWallet(vendorId, runner);
  await runner(`
    UPDATE vendor_wallet_accounts
    SET held_coins = held_coins + :amount, lifetime_earned_coins = lifetime_earned_coins + :amount
    WHERE vendor_id = :vendorId
  `, { vendorId, amount });
  await recordWalletEntry(runner, {
    vendorId,
    serviceBookingId: bookingId,
    paymentSessionId,
    entryType: 'service_booking_hold',
    balanceBucket: 'held',
    direction: 'credit',
    amountCoins: amount,
    amountJmd: booking.totalJmd ?? booking.total_jmd ?? booking.total,
    description: 'Customer service payment converted to held Market Credits.'
  });
}

async function releaseEligibleServiceBookingFunds(bookingId) {
  return transaction(async (tx) => {
    const rows = await tx.query(`
      SELECT
        b.id,
        b.vendor_id AS vendorId,
        b.total_jmd AS totalJmd
      FROM service_bookings b
      WHERE b.id = :bookingId
        AND b.payment_status = 'paid'
        AND b.status IN ('completed', 'customer_confirmed')
        AND b.customer_confirmed_at IS NOT NULL
        AND b.funds_released_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM service_booking_disputes sbd
          WHERE sbd.service_booking_id = b.id AND sbd.status IN ('open', 'under_review')
        )
      LIMIT 1
      FOR UPDATE
    `, { bookingId });
    const booking = rows[0];
    if (!booking) return 0;

    const amount = coinsFromJmd(booking.totalJmd);
    if (!amount) return 0;
    await ensureVendorWallet(booking.vendorId, tx.query);
    const result = await tx.query(`
      UPDATE service_bookings
      SET funds_released_at = CURRENT_TIMESTAMP, status = 'customer_confirmed'
      WHERE id = :bookingId AND funds_released_at IS NULL
    `, { bookingId });
    if (result.affectedRows !== 1) return 0;

    await tx.query(`
      UPDATE vendor_wallet_accounts
      SET held_coins = GREATEST(0, held_coins - :amount), available_coins = available_coins + :amount
      WHERE vendor_id = :vendorId
    `, { vendorId: booking.vendorId, amount });
    await recordWalletEntry(tx.query, {
      vendorId: booking.vendorId,
      serviceBookingId: booking.id,
      entryType: 'service_booking_release',
      balanceBucket: 'held',
      direction: 'debit',
      amountCoins: amount,
      amountJmd: booking.totalJmd,
      description: 'Held service credits released after customer completion confirmation.'
    });
    await recordWalletEntry(tx.query, {
      vendorId: booking.vendorId,
      serviceBookingId: booking.id,
      entryType: 'service_booking_release',
      balanceBucket: 'available',
      direction: 'credit',
      amountCoins: amount,
      amountJmd: booking.totalJmd,
      description: 'Service credits are available for site purchases or checkout request.'
    });
    return 1;
  });
}

async function createOrder({ customer = {}, paymentMethod = 'Dime', items = [] }, customerUserId = null) {
  const cart = customerUserId ? await activeCartForUser(customerUserId) : null;
  const cartItems = customerUserId && !items.length ? await cartItemsForCart(cart.id) : [];
  const usingCartItems = customerUserId && !items.length;
  const orderItems = items.length ? items : cartItems;

  if (!orderItems.length) {
    const error = new Error('Order must include at least one item');
    error.statusCode = 400;
    throw error;
  }

  const user = customerUserId ? await findUserById(customerUserId) : await findDefaultUser('customer');
  if (!user) {
    const error = new Error('No customer account exists for order creation');
    error.statusCode = 400;
    throw error;
  }

  const orderId = `ORD-${Date.now()}`;

  return transaction(async (tx) => {
    const preparedItems = [];
    let subtotal = 0;

    for (const item of orderItems) {
      const productRows = item.productId
        ? await tx.query(`
          SELECT p.id, p.store_id AS storeId, p.vendor_id AS vendorId, p.name, p.price_jmd AS price, p.stock_quantity AS stockQuantity
          FROM products p
          JOIN vendors v ON v.id = p.vendor_id
          ${publicVendorSubscriptionJoin()}
          JOIN stores st ON st.id = p.store_id AND st.status NOT IN ('paused', 'suspended')
          WHERE p.id = :id
            AND p.status = 'published'
            AND v.status = 'active'
            AND v.registration_status = 'registered'
          LIMIT 1
          FOR UPDATE
        `, { id: item.productId })
        : [];
      const product = productRows[0];
      if (item.productId && !product) {
        const error = new Error(`${item.name || 'This item'} is no longer available for order`);
        error.statusCode = 409;
        throw error;
      }
      const vendorId = product?.vendorId || item.vendorId;
      const storeRows = product?.storeId
        ? [{ storeId: product.storeId }]
        : vendorId ? await tx.query(`
          SELECT st.id AS storeId
          FROM vendors v
          ${publicVendorSubscriptionJoin()}
          JOIN stores st ON st.vendor_id = v.id
          WHERE v.id = :vendorId
            AND v.status = 'active'
            AND v.registration_status = 'registered'
            AND st.status NOT IN ('paused', 'suspended')
            AND (:storeId IS NULL OR st.id = :storeId)
          ORDER BY st.created_at
          LIMIT 1
        `, { vendorId, storeId: item.storeId || null }) : [];
      const storeId = storeRows[0]?.storeId;
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
      if (!vendorId || !storeId) {
        const error = new Error('Order item is missing a valid vendor store');
        error.statusCode = 400;
        throw error;
      }
      if (product && Number(product.stockQuantity || 0) < qty) {
        const error = new Error(`${product.name} does not have enough stock for this order`);
        error.statusCode = 409;
        throw error;
      }
      const originalPrice = product ? Number(product.price || 0) : Number(item.price || 0);
      const discount = product ? await bestDiscountForProduct(product, user.id, originalPrice, tx.query, cart?.id || item.cartId || null) : null;
      const unitPrice = discountedUnitPrice(originalPrice, discount);
      let customizationBundle = {
        customizations: [],
        previews: [],
        signature: ''
      };
      if (product?.id) {
        if (usingCartItems) {
          customizationBundle = {
            customizations: Array.isArray(item.customizations) ? item.customizations : [],
            previews: Array.isArray(item.customizationPreviews) ? item.customizationPreviews : [],
            signature: item.customizationSignature || ''
          };
        } else {
          const validation = await validateProductCustomization(product.id, item);
          customizationBundle = {
            customizations: validation.customizations,
            previews: validation.previews,
            signature: validation.customizationSignature
          };
        }
      }
      const customizationAddOnTotal = customizationBundle.customizations.reduce((sum, customization) => sum + Number(customization.priceDeltaJmd || 0), 0);
      const preparedItem = {
        orderItemId: randomUUID(),
        productId: product?.id || null,
        vendorId,
        storeId,
        name: item.name || product?.name || 'Item',
        originalPrice: originalPrice + customizationAddOnTotal,
        price: unitPrice + customizationAddOnTotal,
        qty,
        discount: normalizeDiscount(discount),
        customizationAddOnTotal,
        customizationSignature: customizationBundle.signature,
        customizations: customizationBundle.customizations,
        customizationPreviews: customizationBundle.previews,
        customizationSummary: customizationBundle.customizations.map(customizationSummaryLine)
      };
      preparedItems.push(preparedItem);
      subtotal += preparedItem.price * qty;
    }

    await tx.query(`
      INSERT INTO orders (id, customer_user_id, status, payment_status, payment_method, subtotal_jmd, total_jmd, delivery_address)
      VALUES (:id, :customerUserId, 'pending', 'pending', :paymentMethod, :subtotal, :total, :deliveryAddress)
    `, {
      id: orderId,
      customerUserId: user.id,
      paymentMethod,
      subtotal,
      total: subtotal,
      deliveryAddress: customer.address || null
    });

    for (const item of preparedItems) {
      await tx.query(`
        INSERT INTO order_items (id, order_id, product_id, vendor_id, store_id, item_name, unit_price_jmd, quantity, line_total_jmd)
        VALUES (:orderItemId, :orderId, :productId, :vendorId, :storeId, :itemName, :unitPrice, :qty, :lineTotal)
      `, {
        orderItemId: item.orderItemId,
        orderId,
        productId: item.productId,
        vendorId: item.vendorId,
        storeId: item.storeId,
        itemName: item.name,
        unitPrice: item.price,
        qty: item.qty,
        lineTotal: item.price * item.qty
      });
      if (item.productId) {
        const result = await tx.query(`
          UPDATE products
          SET stock_quantity = stock_quantity - :qty
          WHERE id = :productId AND stock_quantity >= :qty
        `, { productId: item.productId, qty: item.qty });
        if (result.affectedRows !== 1) {
          const error = new Error(`${item.name} stock changed before the order could be confirmed`);
          error.statusCode = 409;
          throw error;
        }
      }
      for (const customization of item.customizations || []) {
        await tx.query(`
          INSERT INTO order_item_customizations (id, order_item_id, field_id, field_key, field_label, field_type, value_text, value_json, price_delta_jmd)
          VALUES (:id, :orderItemId, :fieldId, :fieldKey, :fieldLabel, :fieldType, :valueText, :valueJson, :priceDeltaJmd)
        `, {
          id: randomUUID(),
          orderItemId: item.orderItemId,
          fieldId: customization.fieldId || null,
          fieldKey: customization.fieldKey,
          fieldLabel: customization.fieldLabel,
          fieldType: customization.fieldType,
          valueText: customization.valueText || null,
          valueJson: customization.valueJson === undefined || customization.valueJson === null ? null : JSON.stringify(customization.valueJson),
          priceDeltaJmd: nonNegativeInt(customization.priceDeltaJmd, 0)
        });
      }
      for (const preview of item.customizationPreviews || []) {
        await tx.query(`
          INSERT INTO order_item_customization_previews (id, order_item_id, surface_key, preview_image_url, preview_json)
          VALUES (:id, :orderItemId, :surfaceKey, :previewImageUrl, :previewJson)
        `, {
          id: randomUUID(),
          orderItemId: item.orderItemId,
          surfaceKey: preview.surfaceKey,
          previewImageUrl: preview.previewImageUrl || null,
          previewJson: preview.previewJson === undefined || preview.previewJson === null ? null : JSON.stringify(preview.previewJson)
        });
      }
      if ((item.customizations || []).length || (item.customizationPreviews || []).length) {
        await recordCustomizationAudit({
          orderId,
          orderItemId: item.orderItemId,
          productId: item.productId,
          vendorId: item.vendorId,
          actorUserId: user.id,
          actorRole: 'customer',
          action: 'order_customization_captured',
          details: {
            itemName: item.name,
            signature: item.customizationSignature,
            fields: (item.customizations || []).map((customization) => ({
              fieldKey: customization.fieldKey,
              fieldLabel: customization.fieldLabel,
              fieldType: customization.fieldType,
              valueText: customization.valueText,
              priceDeltaJmd: customization.priceDeltaJmd || 0
            })),
            surfaces: (item.customizationPreviews || []).map((preview) => preview.surfaceKey)
          }
        }, tx.query);
      }
    }

    if (cart) {
      await tx.query("UPDATE carts SET status = 'converted' WHERE id = :cartId", { cartId: cart.id });
    }

    const paymentSessionId = `PAY-${Date.now()}`;
    const checkout = buildOrderCheckout({
      sessionId: paymentSessionId,
      frontendOrigin: config.frontendOrigin,
      orderId
    });
    await tx.query(`
      INSERT INTO payment_sessions (id, order_id, provider, provider_session_id, status, amount_jmd, checkout_url, metadata)
      VALUES (:id, :orderId, :provider, :providerSessionId, 'pending', :amount, :checkoutUrl, JSON_OBJECT('kind', 'customer_order', 'paymentMethod', :paymentMethod))
    `, {
      id: paymentSessionId,
      orderId,
      provider: checkout.provider,
      providerSessionId: checkout.providerSessionId,
      amount: subtotal,
      checkoutUrl: checkout.checkoutUrl,
      paymentMethod
    });

    return {
      orderId,
      invoiceNumber: `INV-${orderId}`,
      status: 'pending',
      paymentStatus: 'pending',
      paymentSessionStatus: 'pending',
      createdAt: new Date().toISOString(),
      customer,
      paymentMethod,
      paymentSession: {
        id: paymentSessionId,
        provider: checkout.provider,
        providerSessionId: checkout.providerSessionId,
        orderId,
        kind: 'customer_order',
        amount: subtotal,
        status: 'pending',
        checkoutUrl: checkout.checkoutUrl,
        createdAt: new Date().toISOString()
      },
      items: preparedItems,
      total: subtotal
    };
  });
}

async function listOrders(customerUserId = null) {
  const rows = await query(`
    SELECT
      o.id AS orderId,
      o.status,
      o.payment_status AS paymentStatus,
      o.payment_method AS paymentMethod,
      pay.id AS paymentSessionId,
      pay.status AS paymentSessionStatus,
      pay.provider AS paymentProvider,
      o.total_jmd AS total,
      o.created_at AS createdAt,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM order_items oi
          WHERE oi.order_id = o.id
            AND oi.fulfillment_status = 'fulfilled'
            AND oi.customer_received_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM order_disputes od
          WHERE od.order_id = o.id AND od.status IN ('open', 'under_review')
        )
        THEN 1 ELSE 0
      END AS canConfirmReceipt,
      (
        SELECT COUNT(*) FROM order_items oi
        WHERE oi.order_id = o.id AND o.payment_status = 'paid' AND oi.funds_released_at IS NULL
      ) AS heldItemCount,
      (
        SELECT MAX(oi.customer_received_at) FROM order_items oi
        WHERE oi.order_id = o.id
      ) AS receiptConfirmedAt,
      (
        SELECT MIN(oi.vendor_completed_at) FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.fulfillment_status = 'fulfilled'
          AND oi.customer_received_at IS NULL
      ) AS waitingReceiptSince,
      (
        SELECT TIMESTAMPDIFF(DAY, MIN(oi.vendor_completed_at), CURRENT_TIMESTAMP) FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.fulfillment_status = 'fulfilled'
          AND oi.customer_received_at IS NULL
      ) AS daysWaitingForReceipt,
      (
        SELECT COUNT(*) FROM order_disputes od
        WHERE od.order_id = o.id AND od.status IN ('open', 'under_review')
      ) AS openDisputeCount,
      (
        SELECT GROUP_CONCAT(DISTINCT od.status ORDER BY od.status SEPARATOR ', ')
        FROM order_disputes od
        WHERE od.order_id = o.id
      ) AS disputeStatus
    FROM orders o
    LEFT JOIN (
      SELECT ps.*
      FROM payment_sessions ps
      INNER JOIN (
        SELECT order_id, MAX(created_at) AS max_created_at
        FROM payment_sessions
        WHERE order_id IS NOT NULL
        GROUP BY order_id
      ) latest ON latest.order_id = ps.order_id AND latest.max_created_at = ps.created_at
    ) pay ON pay.order_id = o.id
    ${customerUserId ? 'WHERE o.customer_user_id = :customerUserId' : ''}
    ORDER BY o.created_at DESC
  `, { customerUserId });
  return rows.map((order) => ({
    ...order,
    total: Number(order.total || 0),
    canConfirmReceipt: Boolean(order.canConfirmReceipt),
    heldItemCount: Number(order.heldItemCount || 0),
    daysWaitingForReceipt: Number(order.daysWaitingForReceipt || 0),
    isReceiptLate: Number(order.daysWaitingForReceipt || 0) >= 2,
    hasOpenDispute: Number(order.openDisputeCount || 0) > 0
  }));
}

async function findOrderById(orderId, customerUserId = null) {
  const rows = await query(`
    SELECT
      o.id AS orderId,
      o.status,
      o.payment_status AS paymentStatus,
      o.payment_method AS paymentMethod,
      pay.id AS paymentSessionId,
      pay.status AS paymentSessionStatus,
      pay.provider AS paymentProvider,
      pay.checkout_url AS paymentCheckoutUrl,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM order_items oi
          WHERE oi.order_id = o.id
            AND oi.fulfillment_status = 'fulfilled'
            AND oi.customer_received_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM order_disputes od
          WHERE od.order_id = o.id AND od.status IN ('open', 'under_review')
        )
        THEN 1 ELSE 0
      END AS canConfirmReceipt,
      (
        SELECT COUNT(*) FROM order_items oi
        WHERE oi.order_id = o.id AND o.payment_status = 'paid' AND oi.funds_released_at IS NULL
      ) AS heldItemCount,
      (
        SELECT MAX(oi.customer_received_at) FROM order_items oi
        WHERE oi.order_id = o.id
      ) AS receiptConfirmedAt,
      (
        SELECT MIN(oi.vendor_completed_at) FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.fulfillment_status = 'fulfilled'
          AND oi.customer_received_at IS NULL
      ) AS waitingReceiptSince,
      (
        SELECT TIMESTAMPDIFF(DAY, MIN(oi.vendor_completed_at), CURRENT_TIMESTAMP) FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.fulfillment_status = 'fulfilled'
          AND oi.customer_received_at IS NULL
      ) AS daysWaitingForReceipt,
      (
        SELECT COUNT(*) FROM order_disputes od
        WHERE od.order_id = o.id AND od.status IN ('open', 'under_review')
      ) AS openDisputeCount,
      (
        SELECT GROUP_CONCAT(DISTINCT od.status ORDER BY od.status SEPARATOR ', ')
        FROM order_disputes od
        WHERE od.order_id = o.id
      ) AS disputeStatus,
      o.total_jmd AS total,
      o.delivery_address AS deliveryAddress,
      o.created_at AS createdAt,
      u.full_name AS customerName,
      COALESCE(u.email, u.phone) AS customerContact
    FROM orders o
    JOIN users u ON u.id = o.customer_user_id
    LEFT JOIN (
      SELECT ps.*
      FROM payment_sessions ps
      INNER JOIN (
        SELECT order_id, MAX(created_at) AS max_created_at
        FROM payment_sessions
        WHERE order_id IS NOT NULL
        GROUP BY order_id
      ) latest ON latest.order_id = ps.order_id AND latest.max_created_at = ps.created_at
    ) pay ON pay.order_id = o.id
    WHERE o.id = :orderId
    ${customerUserId ? 'AND o.customer_user_id = :customerUserId' : ''}
    LIMIT 1
  `, { orderId, customerUserId });
  if (!rows[0]) return null;
  const items = await query(`
    SELECT
      oi.id,
      oi.product_id AS productId,
      oi.item_name AS name,
      oi.unit_price_jmd AS price,
      oi.quantity AS qty,
      oi.line_total_jmd AS lineTotal,
      oi.vendor_id AS vendorId,
      oi.store_id AS storeId,
      v.business_name AS vendorName,
      s.name AS storeName,
      s.slug AS storeSlug,
      oi.fulfillment_status AS fulfillmentStatus,
      oi.vendor_completed_at AS vendorCompletedAt,
      oi.customer_received_at AS customerReceivedAt,
      oi.funds_released_at AS fundsReleasedAt
    FROM order_items oi
    JOIN vendors v ON v.id = oi.vendor_id
    JOIN stores s ON s.id = oi.store_id
    WHERE oi.order_id = :orderId
  `, { orderId });
  const itemIds = items.map((item) => item.id);
  const [customizationRows, previewRows] = itemIds.length ? await Promise.all([
    query(`
      SELECT id, order_item_id AS orderItemId, field_id AS fieldId, field_key AS fieldKey, field_label AS fieldLabel, field_type AS fieldType, value_text AS valueText, value_json AS valueJson, price_delta_jmd AS priceDeltaJmd, created_at AS createdAt
      FROM order_item_customizations
      WHERE FIND_IN_SET(order_item_id, :itemIds)
      ORDER BY created_at
    `, { itemIds: itemIds.join(',') }),
    query(`
      SELECT id, order_item_id AS orderItemId, surface_key AS surfaceKey, preview_image_url AS previewImageUrl, preview_json AS previewJson, created_at AS createdAt
      FROM order_item_customization_previews
      WHERE FIND_IN_SET(order_item_id, :itemIds)
      ORDER BY created_at
    `, { itemIds: itemIds.join(',') })
  ]) : [[], []];
  const customizationsByItem = groupByValue(customizationRows.map(normalizeStoredCustomization), 'orderItemId');
  const previewsByItem = groupByValue(previewRows.map(normalizeStoredPreview), 'orderItemId');
  const itemsWithCustomizations = items.map((item) => {
    const customizations = customizationsByItem.get(item.id) || [];
    const customizationPreviews = previewsByItem.get(item.id) || [];
    const customizationAddOnTotal = customizations.reduce((sum, customization) => sum + Number(customization.priceDeltaJmd || 0), 0);
    return {
      ...item,
      customizations,
      customizationPreviews,
      customizationAddOnTotal,
      customizationSummary: customizations.map(customizationSummaryLine)
    };
  });
  return {
    ...rows[0],
    total: Number(rows[0].total || 0),
    canConfirmReceipt: Boolean(rows[0].canConfirmReceipt),
    heldItemCount: Number(rows[0].heldItemCount || 0),
    daysWaitingForReceipt: Number(rows[0].daysWaitingForReceipt || 0),
    isReceiptLate: Number(rows[0].daysWaitingForReceipt || 0) >= 2,
    hasOpenDispute: Number(rows[0].openDisputeCount || 0) > 0,
    paymentSession: rows[0].paymentSessionId ? {
      id: rows[0].paymentSessionId,
      status: rows[0].paymentSessionStatus,
      provider: rows[0].paymentProvider,
      checkoutUrl: rows[0].paymentCheckoutUrl,
      orderId
    } : null,
    invoiceNumber: `INV-${orderId}`,
    items: itemsWithCustomizations
  };
}

async function ensureOrderPaymentSession(orderId) {
  const existingRows = await query(`
    SELECT id
    FROM payment_sessions
    WHERE order_id = :orderId
    ORDER BY created_at DESC
    LIMIT 1
  `, { orderId });
  if (existingRows[0]) {
    return findPaymentSessionById(existingRows[0].id);
  }

  const orderRows = await query(`
    SELECT id, payment_method AS paymentMethod, total_jmd AS total
    FROM orders
    WHERE id = :orderId
    LIMIT 1
  `, { orderId });
  const order = orderRows[0];
  if (!order) {
    const error = new Error('Order not found');
    error.statusCode = 404;
    throw error;
  }

  const paymentSessionId = `PAY-${Date.now()}`;
  const checkout = buildOrderCheckout({
    sessionId: paymentSessionId,
    frontendOrigin: config.frontendOrigin,
    orderId
  });
  await query(`
    INSERT INTO payment_sessions (id, order_id, provider, provider_session_id, status, amount_jmd, checkout_url, metadata)
    VALUES (:id, :orderId, :provider, :providerSessionId, 'pending', :amount, :checkoutUrl, JSON_OBJECT('kind', 'customer_order', 'paymentMethod', :paymentMethod))
  `, {
    id: paymentSessionId,
    orderId,
    provider: checkout.provider,
    providerSessionId: checkout.providerSessionId,
    amount: Number(order.total || 0),
    checkoutUrl: checkout.checkoutUrl,
    paymentMethod: order.paymentMethod || 'Dime'
  });
  return findPaymentSessionById(paymentSessionId);
}

async function markOrderPaymentPaid(orderId) {
  const session = await ensureOrderPaymentSession(orderId);
  return applyPaidPaymentSession(session.id);
}

async function listVendorOrders(vendorIds = []) {
  if (!vendorIds.length) return [];
  const rows = await query(`
    SELECT
      o.id AS orderId,
      oi.vendor_id AS vendorId,
      v.business_name AS vendorName,
      u.full_name AS customerName,
      COALESCE(u.email, u.phone) AS customerContact,
      o.status,
      o.payment_status AS paymentStatus,
      o.payment_method AS paymentMethod,
      MAX(pay.id) AS paymentSessionId,
      MAX(pay.status) AS paymentSessionStatus,
      MAX(pay.provider) AS paymentProvider,
      o.delivery_address AS deliveryAddress,
      o.created_at AS createdAt,
      COUNT(*) AS productCount,
      SUM(oi.quantity) AS itemCount,
      SUM(oi.line_total_jmd) AS vendorTotal,
      SUM(CASE WHEN o.payment_status = 'paid' AND oi.funds_released_at IS NULL THEN oi.line_total_jmd ELSE 0 END) AS heldCredits,
      SUM(CASE WHEN o.payment_status = 'paid' AND oi.funds_released_at IS NOT NULL THEN oi.line_total_jmd ELSE 0 END) AS releasedCredits,
      SUM(CASE WHEN o.payment_status <> 'paid' THEN oi.line_total_jmd ELSE 0 END) AS pendingPaymentCredits,
      MAX(oi.customer_received_at) AS customerReceivedAt,
      MIN(CASE WHEN oi.fulfillment_status = 'fulfilled' AND oi.customer_received_at IS NULL THEN oi.vendor_completed_at ELSE NULL END) AS waitingReceiptSince,
      TIMESTAMPDIFF(DAY, MIN(CASE WHEN oi.fulfillment_status = 'fulfilled' AND oi.customer_received_at IS NULL THEN oi.vendor_completed_at ELSE NULL END), CURRENT_TIMESTAMP) AS daysWaitingForReceipt,
      COALESCE(MAX(disputes.openDisputeCount), 0) AS openDisputeCount,
      MAX(disputes.disputeStatus) AS disputeStatus,
      CASE
        WHEN SUM(CASE WHEN oi.fulfillment_status = 'fulfilled' THEN 1 ELSE 0 END) = COUNT(*) THEN 'fulfilled'
        WHEN SUM(CASE WHEN oi.fulfillment_status = 'out_for_delivery' THEN 1 ELSE 0 END) > 0 THEN 'out_for_delivery'
        WHEN SUM(CASE WHEN oi.fulfillment_status = 'ready_for_pickup' THEN 1 ELSE 0 END) > 0 THEN 'ready_for_pickup'
        WHEN SUM(CASE WHEN oi.fulfillment_status IN ('preparing', 'fulfilling') THEN 1 ELSE 0 END) > 0 THEN 'preparing'
        ELSE 'pending'
      END AS fulfillmentStatus,
      CASE
        WHEN o.payment_status <> 'paid' THEN 'awaiting_payment'
        WHEN COALESCE(MAX(disputes.openDisputeCount), 0) > 0 THEN 'disputed'
        WHEN SUM(CASE WHEN oi.funds_released_at IS NULL THEN 1 ELSE 0 END) = 0 THEN 'released'
        WHEN SUM(CASE WHEN oi.fulfillment_status = 'fulfilled' AND oi.customer_received_at IS NULL THEN 1 ELSE 0 END) > 0 THEN 'waiting_customer'
        ELSE 'held'
      END AS fundStatus
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN vendors v ON v.id = oi.vendor_id
    JOIN users u ON u.id = o.customer_user_id
    LEFT JOIN (
      SELECT ps.*
      FROM payment_sessions ps
      INNER JOIN (
        SELECT order_id, MAX(created_at) AS max_created_at
        FROM payment_sessions
        WHERE order_id IS NOT NULL
        GROUP BY order_id
      ) latest ON latest.order_id = ps.order_id AND latest.max_created_at = ps.created_at
    ) pay ON pay.order_id = o.id
    LEFT JOIN (
      SELECT
        order_id AS orderId,
        COUNT(CASE WHEN status IN ('open', 'under_review') THEN 1 ELSE NULL END) AS openDisputeCount,
        GROUP_CONCAT(DISTINCT status ORDER BY status SEPARATOR ', ') AS disputeStatus
      FROM order_disputes
      GROUP BY order_id
    ) disputes ON disputes.orderId = o.id
    WHERE FIND_IN_SET(oi.vendor_id, :vendorIds)
    GROUP BY o.id, oi.vendor_id, v.business_name, u.full_name, u.email, u.phone, o.status, o.payment_status, o.payment_method, o.delivery_address, o.created_at
    ORDER BY o.created_at DESC
  `, { vendorIds: vendorIds.join(',') });
  const orderIds = [...new Set(rows.map((order) => order.orderId).filter(Boolean))];
  const orderItems = orderIds.length ? await query(`
    SELECT
      oi.id,
      oi.order_id AS orderId,
      oi.product_id AS productId,
      oi.item_name AS name,
      oi.unit_price_jmd AS price,
      oi.quantity AS qty,
      oi.line_total_jmd AS lineTotal,
      oi.vendor_id AS vendorId,
      oi.store_id AS storeId,
      st.name AS storeName,
      st.slug AS storeSlug,
      oi.fulfillment_status AS fulfillmentStatus,
      oi.vendor_completed_at AS vendorCompletedAt,
      oi.customer_received_at AS customerReceivedAt,
      oi.funds_released_at AS fundsReleasedAt
    FROM order_items oi
    JOIN stores st ON st.id = oi.store_id
    WHERE FIND_IN_SET(oi.vendor_id, :vendorIds)
      AND FIND_IN_SET(oi.order_id, :orderIds)
    ORDER BY oi.created_at, oi.id
  `, { vendorIds: vendorIds.join(','), orderIds: orderIds.join(',') }) : [];
  const orderItemIds = orderItems.map((item) => item.id);
  const [customizationRows, previewRows] = orderItemIds.length ? await Promise.all([
    query(`
      SELECT id, order_item_id AS orderItemId, field_id AS fieldId, field_key AS fieldKey, field_label AS fieldLabel, field_type AS fieldType, value_text AS valueText, value_json AS valueJson, price_delta_jmd AS priceDeltaJmd, created_at AS createdAt
      FROM order_item_customizations
      WHERE FIND_IN_SET(order_item_id, :orderItemIds)
      ORDER BY created_at
    `, { orderItemIds: orderItemIds.join(',') }),
    query(`
      SELECT id, order_item_id AS orderItemId, surface_key AS surfaceKey, preview_image_url AS previewImageUrl, preview_json AS previewJson, created_at AS createdAt
      FROM order_item_customization_previews
      WHERE FIND_IN_SET(order_item_id, :orderItemIds)
      ORDER BY created_at
    `, { orderItemIds: orderItemIds.join(',') })
  ]) : [[], []];
  const customizationsByItem = groupByValue(customizationRows.map(normalizeStoredCustomization), 'orderItemId');
  const previewsByItem = groupByValue(previewRows.map(normalizeStoredPreview), 'orderItemId');
  const itemsByOrderVendor = new Map();
  for (const item of orderItems) {
    const customizations = customizationsByItem.get(item.id) || [];
    const customizationPreviews = previewsByItem.get(item.id) || [];
    const customizationAddOnTotal = customizations.reduce((sum, customization) => sum + Number(customization.priceDeltaJmd || 0), 0);
    const normalized = {
      ...item,
      price: Number(item.price || 0),
      qty: Number(item.qty || 0),
      lineTotal: Number(item.lineTotal || 0),
      customizations,
      customizationPreviews,
      customizationAddOnTotal,
      customizationSummary: customizations.map(customizationSummaryLine)
    };
    const key = `${item.orderId}:${item.vendorId}`;
    const list = itemsByOrderVendor.get(key) || [];
    list.push(normalized);
    itemsByOrderVendor.set(key, list);
  }

  return rows.map((order) => ({
    ...order,
    productCount: Number(order.productCount || 0),
    itemCount: Number(order.itemCount || 0),
    vendorTotal: Number(order.vendorTotal || 0),
    heldCredits: Number(order.heldCredits || 0),
    releasedCredits: Number(order.releasedCredits || 0),
    pendingPaymentCredits: Number(order.pendingPaymentCredits || 0),
    daysWaitingForReceipt: Number(order.daysWaitingForReceipt || 0),
    isReceiptLate: Number(order.daysWaitingForReceipt || 0) >= 2,
    hasOpenDispute: Number(order.openDisputeCount || 0) > 0,
    items: itemsByOrderVendor.get(`${order.orderId}:${order.vendorId}`) || []
  }));
}

async function updateOrderStatus(orderId, body) {
  const status = ['pending', 'confirmed', 'paid', 'fulfilling', 'completed', 'cancelled', 'refunded'].includes(body.status) ? body.status : null;
  const paymentStatus = ['created', 'pending', 'paid', 'failed', 'refunded'].includes(body.paymentStatus) ? body.paymentStatus : null;
  if (!status && !paymentStatus) {
    const error = new Error('Order status update requires status or paymentStatus');
    error.statusCode = 400;
    throw error;
  }
  if (paymentStatus === 'paid') {
    await markOrderPaymentPaid(orderId);
    if (status && status !== 'paid') {
      await query('UPDATE orders SET status = :status WHERE id = :orderId', { orderId, status });
    }
    const order = await findOrderById(orderId);
    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }
    return order;
  }
  await query(`
    UPDATE orders
    SET status = COALESCE(:status, status), payment_status = COALESCE(:paymentStatus, payment_status)
    WHERE id = :orderId
  `, { orderId, status, paymentStatus });
  const order = await findOrderById(orderId);
  if (!order) {
    const error = new Error('Order not found');
    error.statusCode = 404;
    throw error;
  }
  return order;
}

function normalizeFulfillmentStatus(value) {
  if (value === 'fulfilling') return 'preparing';
  return ['pending', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'fulfilled', 'cancelled'].includes(value) ? value : null;
}

async function updateOrderFulfillment(orderId, vendorId, fulfillmentStatus, orderItemId = null, actor = {}) {
  const status = normalizeFulfillmentStatus(fulfillmentStatus);
  if (!status) {
    const error = new Error('Fulfillment update requires a valid fulfillmentStatus');
    error.statusCode = 400;
    throw error;
  }
  const orderRows = await query('SELECT payment_status AS paymentStatus FROM orders WHERE id = :orderId LIMIT 1', { orderId });
  if (orderRows[0]?.paymentStatus !== 'paid') {
    const error = new Error('Vendors can only fulfill orders after payment is confirmed');
    error.statusCode = 409;
    throw error;
  }
  const result = await query(`
    UPDATE order_items
    SET
      fulfillment_status = :status,
      vendor_completed_at = CASE
        WHEN :status = 'fulfilled' THEN COALESCE(vendor_completed_at, CURRENT_TIMESTAMP)
        ELSE vendor_completed_at
      END
    WHERE order_id = :orderId
      AND vendor_id = :vendorId
      ${orderItemId ? 'AND id = :orderItemId' : ''}
    `, { orderId, vendorId, status, orderItemId });
  if (result.affectedRows < 1) {
    const error = new Error('Order item not found for this vendor');
    error.statusCode = 404;
    throw error;
  }
  const customizedRows = await query(`
    SELECT
      oi.id AS orderItemId,
      oi.product_id AS productId,
      oi.vendor_id AS vendorId,
      oi.item_name AS itemName,
      COUNT(oic.id) AS customizationCount
    FROM order_items oi
    LEFT JOIN order_item_customizations oic ON oic.order_item_id = oi.id
    WHERE oi.order_id = :orderId
      AND oi.vendor_id = :vendorId
      ${orderItemId ? 'AND oi.id = :orderItemId' : ''}
    GROUP BY oi.id, oi.product_id, oi.vendor_id, oi.item_name
    HAVING customizationCount > 0
  `, { orderId, vendorId, orderItemId });
  for (const row of customizedRows) {
    await recordCustomizationAudit({
      orderId,
      orderItemId: row.orderItemId,
      productId: row.productId,
      vendorId: row.vendorId,
      actorUserId: actor.actorUserId || null,
      actorRole: actor.actorRole || 'vendor',
      action: 'custom_order_item_fulfillment_update',
      details: {
        itemName: row.itemName,
        fulfillmentStatus: status
      }
    });
  }
  if (status === 'fulfilled') {
    await releaseEligibleOrderFunds(orderId, vendorId);
  }
  await query(`
    UPDATE orders
    SET status = CASE
      WHEN :status = 'cancelled' THEN 'cancelled'
      WHEN :status = 'fulfilled' THEN 'fulfilling'
      ELSE 'fulfilling'
    END
    WHERE id = :orderId AND status NOT IN ('completed', 'cancelled', 'refunded')
  `, { orderId, status });
  if (status === 'fulfilled') {
    await safelyNotify(() => notifyOrderFulfilled(orderId, vendorId));
  }
  return (await listVendorOrders([vendorId])).find((order) => order.orderId === orderId);
}

async function confirmOrderReceived(orderId, customerUserId, allowAdmin = false) {
  const orderRows = await query(`
    SELECT id
    FROM orders
    WHERE id = :orderId
      ${allowAdmin ? '' : 'AND customer_user_id = :customerUserId'}
    LIMIT 1
  `, { orderId, customerUserId });
  if (!orderRows[0]) {
    const error = new Error('Order not found for this customer');
    error.statusCode = 404;
    throw error;
  }

  const disputeRows = await query(`
    SELECT id
    FROM order_disputes
    WHERE order_id = :orderId AND status IN ('open', 'under_review')
    LIMIT 1
  `, { orderId });
  if (disputeRows[0]) {
    const error = new Error('Receipt cannot be confirmed while an order issue is open');
    error.statusCode = 409;
    throw error;
  }

  const result = await query(`
    UPDATE order_items
    SET customer_received_at = COALESCE(customer_received_at, CURRENT_TIMESTAMP)
    WHERE order_id = :orderId
      AND fulfillment_status = 'fulfilled'
      AND customer_received_at IS NULL
  `, { orderId });

  if (result.affectedRows < 1) {
    const error = new Error('No fulfilled items are waiting for receipt confirmation');
    error.statusCode = 409;
    throw error;
  }

  const customizedRows = await query(`
    SELECT
      oi.id AS orderItemId,
      oi.product_id AS productId,
      oi.vendor_id AS vendorId,
      oi.item_name AS itemName,
      COUNT(oic.id) AS customizationCount
    FROM order_items oi
    LEFT JOIN order_item_customizations oic ON oic.order_item_id = oi.id
    WHERE oi.order_id = :orderId
      AND oi.customer_received_at IS NOT NULL
    GROUP BY oi.id, oi.product_id, oi.vendor_id, oi.item_name
    HAVING customizationCount > 0
  `, { orderId });
  for (const row of customizedRows) {
    await recordCustomizationAudit({
      orderId,
      orderItemId: row.orderItemId,
      productId: row.productId,
      vendorId: row.vendorId,
      actorUserId: customerUserId,
      actorRole: allowAdmin ? 'admin' : 'customer',
      action: 'custom_order_item_receipt_confirmed',
      details: {
        itemName: row.itemName
      }
    });
  }

  await releaseEligibleOrderFunds(orderId);
  await query(`
    UPDATE orders
    SET status = 'completed'
    WHERE id = :orderId
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = orders.id
          AND oi.funds_released_at IS NULL
      )
  `, { orderId });
  await safelyNotify(() => notifyOrderReceiptConfirmed(orderId));
  return findOrderById(orderId, allowAdmin ? null : customerUserId);
}

async function createOrderDispute(orderId, body = {}, createdByUserId, role = 'customer') {
  const orderRows = await query(`
    SELECT id, customer_user_id AS customerUserId
    FROM orders
    WHERE id = :orderId
    LIMIT 1
  `, { orderId });
  const order = orderRows[0];
  if (!order) {
    const error = new Error('Order not found');
    error.statusCode = 404;
    throw error;
  }
  if (role === 'customer' && order.customerUserId !== createdByUserId) {
    const error = new Error('Customer account cannot report an issue for this order');
    error.statusCode = 403;
    throw error;
  }

  const vendorId = body.vendorId || null;
  if (vendorId) {
    const vendorRows = await query(`
      SELECT id
      FROM order_items
      WHERE order_id = :orderId AND vendor_id = :vendorId
      LIMIT 1
    `, { orderId, vendorId });
    if (!vendorRows[0]) {
      const error = new Error('Vendor is not connected to this order');
      error.statusCode = 400;
      throw error;
    }
  }

  const reason = ['customer_reported_issue', 'late_receipt_confirmation', 'damaged_item', 'missing_item', 'wrong_item', 'not_delivered'].includes(body.reason)
    ? body.reason
    : role === 'admin'
      ? 'late_receipt_confirmation'
      : 'customer_reported_issue';
  const existingRows = await query(`
    SELECT id, order_id AS orderId, vendor_id AS vendorId, customer_user_id AS customerUserId, reason, status, notes, created_at AS createdAt, updated_at AS updatedAt
    FROM order_disputes
    WHERE order_id = :orderId
      AND ((:vendorId IS NULL AND vendor_id IS NULL) OR vendor_id = :vendorId)
      AND status IN ('open', 'under_review')
    LIMIT 1
  `, { orderId, vendorId });
  if (existingRows[0]) return existingRows[0];

  const id = randomUUID();
  await query(`
    INSERT INTO order_disputes (
      id,
      order_id,
      vendor_id,
      customer_user_id,
      created_by_user_id,
      reason,
      status,
      notes
    )
    VALUES (:id, :orderId, :vendorId, :customerUserId, :createdByUserId, :reason, 'open', :notes)
  `, {
    id,
    orderId,
    vendorId,
    customerUserId: order.customerUserId,
    createdByUserId,
    reason,
    notes: body.notes || null
  });
  const customizedRows = await query(`
    SELECT
      oi.id AS orderItemId,
      oi.product_id AS productId,
      oi.vendor_id AS vendorId,
      oi.item_name AS itemName,
      COUNT(oic.id) AS customizationCount
    FROM order_items oi
    LEFT JOIN order_item_customizations oic ON oic.order_item_id = oi.id
    WHERE oi.order_id = :orderId
      AND (:vendorId IS NULL OR oi.vendor_id = :vendorId)
    GROUP BY oi.id, oi.product_id, oi.vendor_id, oi.item_name
    HAVING customizationCount > 0
  `, { orderId, vendorId });
  for (const row of customizedRows) {
    await recordCustomizationAudit({
      orderId,
      orderItemId: row.orderItemId,
      productId: row.productId,
      vendorId: row.vendorId,
      actorUserId: createdByUserId,
      actorRole: role,
      action: 'custom_order_item_dispute_opened',
      details: {
        itemName: row.itemName,
        reason,
        notes: body.notes || null
      }
    });
  }
  const rows = await query(`
    SELECT id, order_id AS orderId, vendor_id AS vendorId, customer_user_id AS customerUserId, reason, status, notes, created_at AS createdAt, updated_at AS updatedAt
    FROM order_disputes
    WHERE id = :id
    LIMIT 1
  `, { id });
  await safelyNotify(() => notifyOrderDisputeCreated(orderId, vendorId));
  return rows[0];
}

async function defaultStoreIdForVendor(vendorId) {
  const rows = await query('SELECT id FROM stores WHERE vendor_id = :vendorId ORDER BY created_at LIMIT 1', { vendorId });
  return rows[0]?.id || null;
}

async function storeById(storeId) {
  if (!storeId) return null;
  const rows = await query(`
    SELECT
      id,
      vendor_id AS vendorId,
      name,
      slug,
      status
    FROM stores
    WHERE id = :storeId
    LIMIT 1
  `, { storeId });
  return rows[0] || null;
}

async function assertStorePublishAllowed(storeId, vendorId, action = 'publish') {
  const store = await storeById(storeId);
  if (!store || store.vendorId !== vendorId) {
    const error = new Error(`Vendor cannot ${action} because the listing is not connected to this store`);
    error.statusCode = 403;
    error.compliance = {
      severity: 'notice',
      message: 'Listings must belong to the selected vendor store before they can appear publicly.',
      eligibility: { canSell: false, reason: 'store_required_for_public_listing' }
    };
    throw error;
  }
  if (['paused', 'suspended'].includes(store.status)) {
    const error = new Error(`Vendor cannot ${action} while the store is ${store.status}`);
    error.statusCode = 403;
    error.compliance = {
      severity: 'notice',
      message: 'Resume the store before products, foods, or services can appear publicly.',
      eligibility: { canSell: false, reason: 'store_paused_or_suspended' }
    };
    throw error;
  }
  return store;
}

async function vendorIdForStore(storeId) {
  const rows = await query('SELECT vendor_id AS vendorId FROM stores WHERE id = :storeId LIMIT 1', { storeId });
  return rows[0]?.vendorId || null;
}

async function vendorIdForProduct(productId) {
  const rows = await query('SELECT vendor_id AS vendorId FROM products WHERE id = :productId LIMIT 1', { productId });
  return rows[0]?.vendorId || null;
}

async function vendorIdForService(serviceId) {
  const rows = await query('SELECT vendor_id AS vendorId FROM services WHERE id = :serviceId LIMIT 1', { serviceId });
  return rows[0]?.vendorId || null;
}

async function vendorIdForJob(jobId) {
  const rows = await query('SELECT vendor_id AS vendorId FROM jobs WHERE id = :jobId LIMIT 1', { jobId });
  return rows[0]?.vendorId || null;
}

async function nextSubscriptionCost(vendorId, runner = query) {
  const rows = await runner(`
    SELECT plan.monthly_price_jmd AS monthlyPrice
    FROM vendor_subscriptions vs
    JOIN subscription_plans plan ON plan.id = vs.plan_id
    WHERE vs.vendor_id = :vendorId AND vs.status IN ('trial', 'active', 'past_due')
    ORDER BY vs.created_at DESC
    LIMIT 1
  `, { vendorId });
  if (rows[0]) return Number(rows[0].monthlyPrice || 0);

  const fallbackRows = await runner(`
    SELECT monthly_price_jmd AS monthlyPrice
    FROM subscription_plans
    WHERE is_active = TRUE
    ORDER BY monthly_price_jmd
    LIMIT 1
  `);
  return Number(fallbackRows[0]?.monthlyPrice || 0);
}

function checkoutAdvisory(amount, available, nextSubscriptionAmount) {
  const remaining = Math.max(0, available - amount);
  if (amount >= available && nextSubscriptionAmount > 0) {
    return `You are requesting your full available balance. Consider leaving ${nextSubscriptionAmount} credits for your next monthly subscription.`;
  }
  if (remaining < nextSubscriptionAmount && nextSubscriptionAmount > 0) {
    return `After this checkout you will have ${remaining} credits left. Consider keeping ${nextSubscriptionAmount} credits available for your next monthly subscription.`;
  }
  return 'Checkout request created. Funds move to pending checkout until the platform owner pays it out.';
}

async function listVendorWallets(vendorIds) {
  if (!vendorIds.length) return [];
  await Promise.all(vendorIds.map((vendorId) => ensureVendorWallet(vendorId)));
  const rows = await query(`
    SELECT
      vwa.vendor_id AS vendorId,
      v.business_name AS vendorName,
      vwa.available_coins AS availableCoins,
      vwa.held_coins AS heldCoins,
      vwa.pending_checkout_coins AS pendingCheckoutCoins,
      vwa.lifetime_earned_coins AS lifetimeEarnedCoins,
      plan.monthly_price_jmd AS nextSubscriptionCost,
      vwa.updated_at AS updatedAt
    FROM vendor_wallet_accounts vwa
    JOIN vendors v ON v.id = vwa.vendor_id
    LEFT JOIN (
      SELECT vs.*
      FROM vendor_subscriptions vs
      INNER JOIN (
        SELECT vendor_id, MAX(created_at) AS max_created_at
        FROM vendor_subscriptions
        GROUP BY vendor_id
      ) latest ON latest.vendor_id = vs.vendor_id AND latest.max_created_at = vs.created_at
    ) sub ON sub.vendor_id = vwa.vendor_id
    LEFT JOIN subscription_plans plan ON plan.id = sub.plan_id
    WHERE FIND_IN_SET(vwa.vendor_id, :vendorIds)
    ORDER BY v.business_name
  `, { vendorIds: vendorIds.join(',') });
  return Promise.all(rows.map(async (row) => {
    const normalized = normalizeWallet(row);
    const nextCostValue = row.nextSubscriptionCost === null || row.nextSubscriptionCost === undefined
      ? await nextSubscriptionCost(row.vendorId)
      : row.nextSubscriptionCost;
    const nextCost = Number(nextCostValue || 0);
    return {
      ...normalized,
      vendorName: row.vendorName,
      nextSubscriptionCost: nextCost,
      checkoutRecommendation: nextCost > 0
        ? `Keep ${nextCost} credits available for the next subscription cycle.`
        : 'No subscription reserve is currently required.'
    };
  }));
}

async function listVendorWalletLedger(vendorIds, limit = 80) {
  if (!vendorIds.length) return [];
  const rowLimit = Math.min(Math.max(Number(limit) || 80, 1), 10000);
  const rows = await query(`
    SELECT
      id,
      vendor_id AS vendorId,
      order_id AS orderId,
      order_item_id AS orderItemId,
      service_booking_id AS serviceBookingId,
      checkout_request_id AS checkoutRequestId,
      product_id AS productId,
      payment_session_id AS paymentSessionId,
      entry_type AS entryType,
      balance_bucket AS balanceBucket,
      direction,
      amount_coins AS amountCoins,
      amount_jmd AS amountJmd,
      description,
      created_at AS createdAt
    FROM vendor_wallet_ledger
    WHERE FIND_IN_SET(vendor_id, :vendorIds)
    ORDER BY created_at DESC
    LIMIT ${rowLimit}
  `, { vendorIds: vendorIds.join(',') });
  return rows.map((row) => ({
    ...row,
    amountCoins: Number(row.amountCoins || 0),
    amountJmd: Number(row.amountJmd || 0)
  }));
}

async function listVendorCheckoutRequests(vendorIds) {
  if (!vendorIds.length) return [];
  const rows = await query(`
    SELECT
      r.id,
      r.vendor_id AS vendorId,
      v.business_name AS vendorName,
      r.amount_coins AS amountCoins,
      r.amount_jmd AS amountJmd,
      r.payout_method AS payoutMethod,
      r.payout_details AS payoutDetails,
      r.status,
      r.advisory_message AS advisoryMessage,
      r.created_at AS createdAt,
      r.updated_at AS updatedAt
    FROM vendor_checkout_requests r
    JOIN vendors v ON v.id = r.vendor_id
    WHERE FIND_IN_SET(r.vendor_id, :vendorIds)
    ORDER BY r.created_at DESC
  `, { vendorIds: vendorIds.join(',') });
  return rows.map((row) => ({
    ...row,
    amountCoins: Number(row.amountCoins || 0),
    amountJmd: Number(row.amountJmd || 0)
  }));
}

async function listVendorPayoutProfiles(vendorIds) {
  if (!vendorIds.length) return [];
  return query(`
    SELECT
      vendor_id AS vendorId,
      payout_method AS payoutMethod,
      payout_details AS payoutDetails,
      updated_by_user_id AS updatedByUserId,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM vendor_payout_profiles
    WHERE FIND_IN_SET(vendor_id, :vendorIds)
  `, { vendorIds: vendorIds.join(',') });
}

async function upsertVendorPayoutProfile(body, updatedByUserId = null) {
  const vendor = await findVendorById(body.vendorId);
  if (!vendor) {
    const error = new Error('Payout profile requires a valid vendor');
    error.statusCode = 400;
    throw error;
  }

  const payoutMethod = String(body.payoutMethod || 'bank_transfer').trim() || 'bank_transfer';
  const payoutDetails = String(body.payoutDetails || '').trim();
  if (!payoutDetails) {
    const error = new Error('Payout details are required');
    error.statusCode = 400;
    throw error;
  }

  await query(`
    INSERT INTO vendor_payout_profiles (
      vendor_id,
      payout_method,
      payout_details,
      updated_by_user_id
    )
    VALUES (:vendorId, :payoutMethod, :payoutDetails, :updatedByUserId)
    ON DUPLICATE KEY UPDATE
      payout_method = VALUES(payout_method),
      payout_details = VALUES(payout_details),
      updated_by_user_id = VALUES(updated_by_user_id)
  `, {
    vendorId: vendor.id,
    payoutMethod,
    payoutDetails,
    updatedByUserId
  });

  const rows = await listVendorPayoutProfiles([vendor.id]);
  return rows[0] || {
    vendorId: vendor.id,
    payoutMethod,
    payoutDetails,
    updatedByUserId
  };
}

async function listWalletAuditReport(vendorIds = []) {
  if (!vendorIds.length) return [];
  await Promise.all(vendorIds.map((vendorId) => ensureVendorWallet(vendorId)));

  const [walletRows, ledgerRows, orderRows, serviceRows, duplicateRows] = await Promise.all([
    query(`
      SELECT
        vwa.vendor_id AS vendorId,
        v.business_name AS vendorName,
        vwa.available_coins AS availableCoins,
        vwa.held_coins AS heldCoins,
        vwa.pending_checkout_coins AS pendingCheckoutCoins,
        vwa.lifetime_earned_coins AS lifetimeEarnedCoins
      FROM vendor_wallet_accounts vwa
      JOIN vendors v ON v.id = vwa.vendor_id
      WHERE FIND_IN_SET(vwa.vendor_id, :vendorIds)
      ORDER BY v.business_name
    `, { vendorIds: vendorIds.join(',') }),
    query(`
      SELECT
        vendor_id AS vendorId,
        SUM(CASE
          WHEN balance_bucket = 'held' AND direction = 'credit' THEN amount_coins
          WHEN balance_bucket = 'held' AND direction = 'debit' THEN -amount_coins
          ELSE 0
        END) AS ledgerHeldCoins,
        SUM(CASE
          WHEN balance_bucket = 'available' AND direction = 'credit' THEN amount_coins
          WHEN balance_bucket = 'available' AND direction = 'debit' THEN -amount_coins
          ELSE 0
        END) AS ledgerAvailableCoins,
        SUM(CASE
          WHEN balance_bucket = 'pending_checkout' AND direction = 'credit' THEN amount_coins
          WHEN balance_bucket = 'pending_checkout' AND direction = 'debit' THEN -amount_coins
          ELSE 0
        END) AS ledgerPendingCheckoutCoins,
        SUM(CASE WHEN entry_type IN ('order_hold', 'service_booking_hold') AND direction = 'credit' THEN amount_coins ELSE 0 END) AS ledgerLifetimeEarnedCoins
      FROM vendor_wallet_ledger
      WHERE FIND_IN_SET(vendor_id, :vendorIds)
      GROUP BY vendor_id
    `, { vendorIds: vendorIds.join(',') }),
    query(`
      SELECT
        oi.vendor_id AS vendorId,
        SUM(CASE
          WHEN o.payment_status = 'paid'
            AND o.status NOT IN ('cancelled', 'refunded')
            AND oi.funds_released_at IS NULL
          THEN oi.line_total_jmd ELSE 0
        END) AS expectedHeldCoins,
        SUM(CASE
          WHEN o.payment_status = 'paid'
            AND o.status NOT IN ('cancelled', 'refunded')
          THEN oi.line_total_jmd ELSE 0
        END) AS paidOrderValueCoins,
        COUNT(CASE
          WHEN o.payment_status = 'paid'
            AND o.status NOT IN ('cancelled', 'refunded')
            AND oi.funds_released_at IS NULL
          THEN 1 ELSE NULL
        END) AS unreleasedPaidItemCount
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE FIND_IN_SET(oi.vendor_id, :vendorIds)
      GROUP BY oi.vendor_id
    `, { vendorIds: vendorIds.join(',') }),
    query(`
      SELECT
        b.vendor_id AS vendorId,
        SUM(CASE
          WHEN b.payment_status = 'paid'
            AND b.status NOT IN ('cancelled')
            AND b.funds_released_at IS NULL
          THEN b.total_jmd ELSE 0
        END) AS expectedHeldCoins,
        SUM(CASE
          WHEN b.payment_status = 'paid'
            AND b.status NOT IN ('cancelled')
          THEN b.total_jmd ELSE 0
        END) AS paidServiceValueCoins,
        COUNT(CASE
          WHEN b.payment_status = 'paid'
            AND b.status NOT IN ('cancelled')
            AND b.funds_released_at IS NULL
          THEN 1 ELSE NULL
        END) AS unreleasedPaidBookingCount
      FROM service_bookings b
      WHERE FIND_IN_SET(b.vendor_id, :vendorIds)
      GROUP BY b.vendor_id
    `, { vendorIds: vendorIds.join(',') }),
    query(`
      SELECT vendor_id AS vendorId, COUNT(*) AS duplicateGroups
      FROM (
        SELECT vendor_id, COALESCE(order_item_id, service_booking_id) AS sourceId, entry_type, balance_bucket, direction, COUNT(*) AS duplicateCount
        FROM vendor_wallet_ledger
        WHERE (order_item_id IS NOT NULL OR service_booking_id IS NOT NULL)
          AND FIND_IN_SET(vendor_id, :vendorIds)
        GROUP BY vendor_id, sourceId, entry_type, balance_bucket, direction
        HAVING duplicateCount > 1
      ) duplicate_groups
      GROUP BY vendor_id
    `, { vendorIds: vendorIds.join(',') })
  ]);

  const byVendor = (rows) => new Map(rows.map((row) => [row.vendorId, row]));
  const ledgerMap = byVendor(ledgerRows);
  const orderMap = byVendor(orderRows);
  const serviceMap = byVendor(serviceRows);
  const duplicateMap = byVendor(duplicateRows);

  return walletRows.map((wallet) => {
    const ledger = ledgerMap.get(wallet.vendorId) || {};
    const order = orderMap.get(wallet.vendorId) || {};
    const service = serviceMap.get(wallet.vendorId) || {};
    const duplicate = duplicateMap.get(wallet.vendorId) || {};
    const report = {
      vendorId: wallet.vendorId,
      vendorName: wallet.vendorName,
      accountHeldCoins: Number(wallet.heldCoins || 0),
      ledgerHeldCoins: Number(ledger.ledgerHeldCoins || 0),
      expectedHeldCoins: Number(order.expectedHeldCoins || 0) + Number(service.expectedHeldCoins || 0),
      accountAvailableCoins: Number(wallet.availableCoins || 0),
      ledgerAvailableCoins: Number(ledger.ledgerAvailableCoins || 0),
      accountPendingCheckoutCoins: Number(wallet.pendingCheckoutCoins || 0),
      ledgerPendingCheckoutCoins: Number(ledger.ledgerPendingCheckoutCoins || 0),
      accountLifetimeEarnedCoins: Number(wallet.lifetimeEarnedCoins || 0),
      ledgerLifetimeEarnedCoins: Number(ledger.ledgerLifetimeEarnedCoins || 0),
      paidOrderValueCoins: Number(order.paidOrderValueCoins || 0) + Number(service.paidServiceValueCoins || 0),
      unreleasedPaidItemCount: Number(order.unreleasedPaidItemCount || 0) + Number(service.unreleasedPaidBookingCount || 0),
      duplicateLedgerGroups: Number(duplicate.duplicateGroups || 0),
      mismatches: []
    };

    if (report.accountHeldCoins !== report.ledgerHeldCoins) report.mismatches.push('held_account_vs_ledger');
    if (report.accountHeldCoins !== report.expectedHeldCoins) report.mismatches.push('held_account_vs_orders');
    if (report.accountAvailableCoins !== report.ledgerAvailableCoins) report.mismatches.push('available_account_vs_ledger');
    if (report.accountPendingCheckoutCoins !== report.ledgerPendingCheckoutCoins) report.mismatches.push('pending_checkout_account_vs_ledger');
    if (report.accountLifetimeEarnedCoins !== report.ledgerLifetimeEarnedCoins) report.mismatches.push('lifetime_account_vs_ledger');
    if (report.duplicateLedgerGroups > 0) report.mismatches.push('duplicate_ledger_entries');

    return {
      ...report,
      status: report.mismatches.length ? 'mismatch' : 'ok'
    };
  });
}

async function ledgerTotalsForVendor(runner, vendorId) {
  const rows = await runner(`
    SELECT
      SUM(CASE
        WHEN balance_bucket = 'held' AND direction = 'credit' THEN amount_coins
        WHEN balance_bucket = 'held' AND direction = 'debit' THEN -amount_coins
        ELSE 0
      END) AS heldCoins,
      SUM(CASE
        WHEN balance_bucket = 'available' AND direction = 'credit' THEN amount_coins
        WHEN balance_bucket = 'available' AND direction = 'debit' THEN -amount_coins
        ELSE 0
      END) AS availableCoins,
      SUM(CASE
        WHEN balance_bucket = 'pending_checkout' AND direction = 'credit' THEN amount_coins
        WHEN balance_bucket = 'pending_checkout' AND direction = 'debit' THEN -amount_coins
        ELSE 0
      END) AS pendingCheckoutCoins,
      SUM(CASE WHEN entry_type IN ('order_hold', 'service_booking_hold') AND direction = 'credit' THEN amount_coins ELSE 0 END) AS lifetimeEarnedCoins
    FROM vendor_wallet_ledger
    WHERE vendor_id = :vendorId
  `, { vendorId });
  const totals = rows[0] || {};
  return {
    heldCoins: Math.max(0, Number(totals.heldCoins || 0)),
    availableCoins: Math.max(0, Number(totals.availableCoins || 0)),
    pendingCheckoutCoins: Math.max(0, Number(totals.pendingCheckoutCoins || 0)),
    lifetimeEarnedCoins: Math.max(0, Number(totals.lifetimeEarnedCoins || 0))
  };
}

async function repairWalletAudit(vendorId, adminUserId = null) {
  const vendor = await findVendorById(vendorId);
  if (!vendor) {
    const error = new Error('Vendor not found');
    error.statusCode = 404;
    throw error;
  }

  const result = await transaction(async (tx) => {
    await ensureVendorWallet(vendorId, tx.query);
    const missingHoldItems = await tx.query(`
      SELECT
        oi.id AS orderItemId,
        oi.order_id AS orderId,
        oi.product_id AS productId,
        oi.vendor_id AS vendorId,
        oi.unit_price_jmd AS price,
        oi.quantity AS qty,
        pay.id AS paymentSessionId
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN (
        SELECT ps.*
        FROM payment_sessions ps
        INNER JOIN (
          SELECT order_id, MAX(created_at) AS max_created_at
          FROM payment_sessions
          WHERE order_id IS NOT NULL
          GROUP BY order_id
        ) latest ON latest.order_id = ps.order_id AND latest.max_created_at = ps.created_at
      ) pay ON pay.order_id = o.id
      WHERE oi.vendor_id = :vendorId
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
        AND oi.funds_released_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM vendor_wallet_ledger ledger
          WHERE ledger.order_item_id = oi.id
            AND ledger.entry_type = 'order_hold'
            AND ledger.balance_bucket = 'held'
            AND ledger.direction = 'credit'
        )
      FOR UPDATE
    `, { vendorId });

    for (const item of missingHoldItems) {
      await creditOrderHold(tx.query, item.orderId, item, item.paymentSessionId);
    }

    const missingServiceHoldBookings = await tx.query(`
      SELECT
        b.id,
        b.vendor_id AS vendorId,
        b.total_jmd AS totalJmd,
        pay.id AS paymentSessionId
      FROM service_bookings b
      LEFT JOIN (
        SELECT ps.*
        FROM payment_sessions ps
        INNER JOIN (
          SELECT service_booking_id, MAX(created_at) AS max_created_at
          FROM payment_sessions
          WHERE service_booking_id IS NOT NULL
          GROUP BY service_booking_id
        ) latest ON latest.service_booking_id = ps.service_booking_id AND latest.max_created_at = ps.created_at
      ) pay ON pay.service_booking_id = b.id
      WHERE b.vendor_id = :vendorId
        AND b.payment_status = 'paid'
        AND b.status NOT IN ('cancelled')
        AND b.funds_released_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM vendor_wallet_ledger ledger
          WHERE ledger.service_booking_id = b.id
            AND ledger.entry_type = 'service_booking_hold'
            AND ledger.balance_bucket = 'held'
            AND ledger.direction = 'credit'
        )
      FOR UPDATE
    `, { vendorId });

    for (const booking of missingServiceHoldBookings) {
      await creditServiceBookingHold(tx.query, booking, booking.paymentSessionId);
    }

    const totals = await ledgerTotalsForVendor(tx.query, vendorId);
    await tx.query(`
      UPDATE vendor_wallet_accounts
      SET
        held_coins = :heldCoins,
        available_coins = :availableCoins,
        pending_checkout_coins = :pendingCheckoutCoins,
        lifetime_earned_coins = :lifetimeEarnedCoins
      WHERE vendor_id = :vendorId
    `, { vendorId, ...totals });

    await recordAuditEntry(tx.query, {
      adminUserId,
      action: 'wallet_repair',
      entityType: 'vendor_wallet_account',
      entityId: vendorId,
      details: {
        vendorId,
        missingHoldItemsAdded: missingHoldItems.length,
        missingServiceHoldsAdded: missingServiceHoldBookings.length,
        rebuiltTotals: totals
      }
    });

    return { vendorId, missingHoldItemsAdded: missingHoldItems.length, missingServiceHoldsAdded: missingServiceHoldBookings.length, rebuiltTotals: totals };
  });

  const auditRows = await listWalletAuditReport([vendorId]);
  return { ...result, audit: auditRows[0] || null };
}

async function createVendorCheckoutRequest(body, requestedByUserId) {
  const vendor = await findVendorById(body.vendorId);
  if (!vendor) {
    const error = new Error('Checkout request requires a valid vendor');
    error.statusCode = 400;
    throw error;
  }
  const amount = Math.floor(Number(body.amountCoins ?? body.amountJmd ?? body.amount) || 0);
  if (amount <= 0) {
    const error = new Error('Checkout request requires an amount greater than zero');
    error.statusCode = 400;
    throw error;
  }

  const result = await transaction(async (tx) => {
    await ensureVendorWallet(vendor.id, tx.query);
    const walletRows = await tx.query(`
      SELECT available_coins AS availableCoins
      FROM vendor_wallet_accounts
      WHERE vendor_id = :vendorId
      FOR UPDATE
    `, { vendorId: vendor.id });
    const available = Number(walletRows[0]?.availableCoins || 0);
    if (amount > available) {
      const error = new Error('Checkout amount cannot exceed available credits');
      error.statusCode = 409;
      throw error;
    }

    const nextCost = await nextSubscriptionCost(vendor.id, tx.query);
    const advisory = checkoutAdvisory(amount, available, nextCost);
    const payoutRows = await tx.query(`
      SELECT payout_method AS payoutMethod, payout_details AS payoutDetails
      FROM vendor_payout_profiles
      WHERE vendor_id = :vendorId
      LIMIT 1
    `, { vendorId: vendor.id });
    const savedPayout = payoutRows[0] || {};
    const payoutMethod = String(body.payoutMethod || savedPayout.payoutMethod || 'bank_transfer').trim() || 'bank_transfer';
    const payoutDetails = String(body.payoutDetails || savedPayout.payoutDetails || '').trim() || null;
    const id = randomUUID();
    await tx.query(`
      INSERT INTO vendor_checkout_requests (
        id,
        vendor_id,
        requested_by_user_id,
        amount_coins,
        amount_jmd,
        payout_method,
        payout_details,
        status,
        advisory_message
      )
      VALUES (:id, :vendorId, :requestedByUserId, :amount, :amountJmd, :payoutMethod, :payoutDetails, 'requested', :advisory)
    `, {
      id,
      vendorId: vendor.id,
      requestedByUserId,
      amount,
      amountJmd: amount * COIN_JMD_RATE,
      payoutMethod,
      payoutDetails,
      advisory
    });
    await tx.query(`
      UPDATE vendor_wallet_accounts
      SET available_coins = available_coins - :amount,
          pending_checkout_coins = pending_checkout_coins + :amount
      WHERE vendor_id = :vendorId
    `, { vendorId: vendor.id, amount });
    await recordWalletEntry(tx.query, {
      vendorId: vendor.id,
      checkoutRequestId: id,
      entryType: 'checkout_request',
      balanceBucket: 'available',
      direction: 'debit',
      amountCoins: amount,
      amountJmd: amount * COIN_JMD_RATE,
      description: 'Vendor checkout request moved credits out of available balance.'
    });
    await recordWalletEntry(tx.query, {
      vendorId: vendor.id,
      checkoutRequestId: id,
      entryType: 'checkout_request',
      balanceBucket: 'pending_checkout',
      direction: 'credit',
      amountCoins: amount,
      amountJmd: amount * COIN_JMD_RATE,
      description: 'Credits are pending owner payout.'
    });
    return {
      id,
      vendorId: vendor.id,
      amountCoins: amount,
      amountJmd: amount * COIN_JMD_RATE,
      payoutMethod,
      payoutDetails,
      status: 'requested',
      advisoryMessage: advisory,
      wallet: await ensureVendorWallet(vendor.id, tx.query)
    };
  });
  await safelyNotify(() => notifyCheckoutRequestCreated(result.id));
  return result;
}

async function updateVendorCheckoutRequestStatus(requestId, body) {
  const status = ['approved', 'paid', 'cancelled', 'rejected'].includes(body.status) ? body.status : null;
  if (!status) {
    const error = new Error('Checkout request status must be approved, paid, cancelled, or rejected');
    error.statusCode = 400;
    throw error;
  }

  const result = await transaction(async (tx) => {
    const rows = await tx.query(`
      SELECT id, vendor_id AS vendorId, amount_coins AS amountCoins, status
      FROM vendor_checkout_requests
      WHERE id = :requestId
      FOR UPDATE
    `, { requestId });
    const request = rows[0];
    if (!request) {
      const error = new Error('Checkout request not found');
      error.statusCode = 404;
      throw error;
    }
    if (request.status === 'paid' || request.status === 'cancelled' || request.status === 'rejected') {
      const error = new Error('Finalized checkout requests cannot be changed');
      error.statusCode = 409;
      throw error;
    }

    await ensureVendorWallet(request.vendorId, tx.query);
    const amount = Number(request.amountCoins || 0);
    if (status === 'paid') {
      await tx.query(`
        UPDATE vendor_wallet_accounts
        SET pending_checkout_coins = GREATEST(0, pending_checkout_coins - :amount)
        WHERE vendor_id = :vendorId
      `, { vendorId: request.vendorId, amount });
      await recordWalletEntry(tx.query, {
        vendorId: request.vendorId,
        checkoutRequestId: request.id,
        entryType: 'checkout_paid',
        balanceBucket: 'pending_checkout',
        direction: 'debit',
        amountCoins: amount,
        amountJmd: amount * COIN_JMD_RATE,
        description: 'Platform owner marked checkout payout as paid.'
      });
    }
    if (status === 'cancelled' || status === 'rejected') {
      await tx.query(`
        UPDATE vendor_wallet_accounts
        SET pending_checkout_coins = GREATEST(0, pending_checkout_coins - :amount),
            available_coins = available_coins + :amount
        WHERE vendor_id = :vendorId
      `, { vendorId: request.vendorId, amount });
      await recordWalletEntry(tx.query, {
        vendorId: request.vendorId,
        checkoutRequestId: request.id,
        entryType: `checkout_${status}`,
        balanceBucket: 'pending_checkout',
        direction: 'debit',
        amountCoins: amount,
        amountJmd: amount * COIN_JMD_RATE,
        description: 'Checkout request no longer pending.'
      });
      await recordWalletEntry(tx.query, {
        vendorId: request.vendorId,
        checkoutRequestId: request.id,
        entryType: `checkout_${status}`,
        balanceBucket: 'available',
        direction: 'credit',
        amountCoins: amount,
        amountJmd: amount * COIN_JMD_RATE,
        description: 'Credits returned to available balance.'
      });
    }

    await tx.query('UPDATE vendor_checkout_requests SET status = :status WHERE id = :requestId', { requestId, status });
    const updatedRows = await tx.query(`
      SELECT
        id,
        vendor_id AS vendorId,
        amount_coins AS amountCoins,
        amount_jmd AS amountJmd,
        payout_method AS payoutMethod,
        payout_details AS payoutDetails,
        status,
        advisory_message AS advisoryMessage,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM vendor_checkout_requests
      WHERE id = :requestId
      LIMIT 1
    `, { requestId });
    return {
      ...updatedRows[0],
      amountCoins: Number(updatedRows[0]?.amountCoins || 0),
      amountJmd: Number(updatedRows[0]?.amountJmd || 0)
    };
  });
  await safelyNotify(() => notifyCheckoutRequestStatusChanged(result.id, result.status));
  return result;
}

async function paySubscriptionWithWallet(body) {
  const vendor = await findVendorById(body.vendorId);
  const planRows = await query('SELECT id, code, name, monthly_price_jmd AS monthlyPrice FROM subscription_plans WHERE code = :planId OR id = :planId LIMIT 1', { planId: body.planId });
  const plan = planRows[0];
  if (!vendor || !plan) {
    const error = new Error('Wallet subscription payment requires a valid vendor and plan');
    error.statusCode = 400;
    throw error;
  }
  const amount = coinsFromJmd(plan.monthlyPrice);
  const result = await transaction(async (tx) => {
    await ensureVendorWallet(vendor.id, tx.query);
    const walletRows = await tx.query('SELECT available_coins AS availableCoins FROM vendor_wallet_accounts WHERE vendor_id = :vendorId FOR UPDATE', { vendorId: vendor.id });
    const available = Number(walletRows[0]?.availableCoins || 0);
    if (available < amount) {
      const error = new Error('Not enough available credits to pay this subscription');
      error.statusCode = 409;
      throw error;
    }
    const paymentSessionId = `WALLET-${Date.now()}`;
    await tx.query(`
      INSERT INTO payment_sessions (id, vendor_id, plan_id, provider, provider_session_id, status, amount_jmd, checkout_url, metadata, paid_at)
      VALUES (:id, :vendorId, :planId, 'market_credits', :providerSessionId, 'paid', :amountJmd, NULL, JSON_OBJECT('kind', 'vendor_subscription_wallet', 'planCode', :planCode), CURRENT_TIMESTAMP)
    `, {
      id: paymentSessionId,
      vendorId: vendor.id,
      planId: plan.id,
      providerSessionId: paymentSessionId,
      amountJmd: Number(plan.monthlyPrice || 0),
      planCode: plan.code
    });
    await tx.query('UPDATE vendor_wallet_accounts SET available_coins = available_coins - :amount WHERE vendor_id = :vendorId', { vendorId: vendor.id, amount });
    await recordWalletEntry(tx.query, {
      vendorId: vendor.id,
      paymentSessionId,
      entryType: 'subscription_payment',
      balanceBucket: 'available',
      direction: 'debit',
      amountCoins: amount,
      amountJmd: Number(plan.monthlyPrice || 0),
      description: `Paid ${plan.name} subscription with Market Credits.`
    });
    const nextPeriodEnd = new Date();
    nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);
    await tx.query(`
      UPDATE vendor_subscriptions
      SET status = 'cancelled'
      WHERE vendor_id = :vendorId AND status IN ('trial', 'active', 'past_due')
    `, { vendorId: vendor.id });
    await tx.query(`
      INSERT INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, last_payment_at)
      VALUES (:vendorId, :planId, 'active', CURRENT_DATE, :currentPeriodEnd, CURRENT_TIMESTAMP)
    `, {
      vendorId: vendor.id,
      planId: plan.id,
      currentPeriodEnd: nextPeriodEnd.toISOString().split('T')[0]
    });
    return { wallet: await ensureVendorWallet(vendor.id, tx.query), paymentSessionId };
  });
  await safelyNotify(() => notifySubscriptionPaymentConfirmed(vendor.id, result.paymentSessionId));
  return { ...result, vendor: await findVendorById(vendor.id) };
}

async function featureProductWithWallet(productId, body) {
  const productRows = await query(`
    SELECT id, vendor_id AS vendorId, store_id AS storeId, name, status
    FROM products
    WHERE id = :productId
    LIMIT 1
  `, { productId });
  const product = productRows[0];
  if (!product) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    throw error;
  }
  const vendor = await findVendorById(product.vendorId);
  assertPublishAllowed(vendor, 'feature products');
  await assertStorePublishAllowed(product.storeId, product.vendorId, 'feature products');
  if (product.status !== 'published') {
    const error = new Error('Only published products can be featured');
    error.statusCode = 403;
    throw error;
  }
  const days = Math.max(1, Math.min(30, Math.floor(Number(body.days) || FEATURE_PRODUCT_DAYS)));
  const amount = Math.max(FEATURE_PRODUCT_COST_COINS, Math.floor(Number(body.costCoins) || FEATURE_PRODUCT_COST_COINS));

  return transaction(async (tx) => {
    await ensureVendorWallet(product.vendorId, tx.query);
    const walletRows = await tx.query('SELECT available_coins AS availableCoins FROM vendor_wallet_accounts WHERE vendor_id = :vendorId FOR UPDATE', { vendorId: product.vendorId });
    const available = Number(walletRows[0]?.availableCoins || 0);
    if (available < amount) {
      const error = new Error('Not enough available credits to feature this product');
      error.statusCode = 409;
      throw error;
    }
    const id = randomUUID();
    const endsAt = new Date(Date.now() + days * 86400000);
    await tx.query(`
      INSERT INTO product_features (id, vendor_id, product_id, starts_at, ends_at, cost_coins, status)
      VALUES (:id, :vendorId, :productId, CURRENT_TIMESTAMP, :endsAt, :amount, 'active')
    `, {
      id,
      vendorId: product.vendorId,
      productId,
      endsAt,
      amount
    });
    await tx.query('UPDATE vendor_wallet_accounts SET available_coins = available_coins - :amount WHERE vendor_id = :vendorId', { vendorId: product.vendorId, amount });
    await recordWalletEntry(tx.query, {
      vendorId: product.vendorId,
      productId,
      entryType: 'product_feature',
      balanceBucket: 'available',
      direction: 'debit',
      amountCoins: amount,
      amountJmd: amount * COIN_JMD_RATE,
      description: `Featured ${product.name} for ${days} days.`
    });
    return {
      id,
      productId,
      vendorId: product.vendorId,
      costCoins: amount,
      endsAt: endsAt.toISOString(),
      wallet: await ensureVendorWallet(product.vendorId, tx.query)
    };
  });
}

async function vendorIdForDocument(documentId) {
  const rows = await query('SELECT vendor_id AS vendorId FROM vendor_documents WHERE id = :documentId LIMIT 1', { documentId });
  return rows[0]?.vendorId || null;
}

async function findVendorDocumentById(documentId) {
  const rows = await query(`
    SELECT id, vendor_id AS vendorId, document_type AS documentType, file_url AS fileUrl, status, reviewed_at AS reviewedAt
    FROM vendor_documents
    WHERE id = :documentId
    LIMIT 1
  `, { documentId });
  return rows[0] || null;
}

async function vendorDocumentDownload(documentId) {
  const document = await findVendorDocumentById(documentId);
  if (!document || !document.fileUrl || /^https?:\/\//i.test(document.fileUrl)) {
    return null;
  }

  const fileName = path.basename(document.fileUrl);
  const download = await uploadMediaDownload(fileName, VENDOR_DOCUMENT_UPLOAD_DIR, 'vendor-documents', contentTypeForDocument);
  return download ? { ...document, ...download } : null;
}

async function uploadMediaDownload(fileName, uploadDir, storageFolder, fallbackContentType) {
  const safeName = path.basename(String(fileName || ''));
  if (!safeName) return null;
  const filePath = path.resolve(uploadDir, safeName);
  const uploadRoot = path.resolve(uploadDir);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
    return null;
  }

  try {
    return {
      fileName: safeName,
      buffer: await fs.readFile(filePath),
      contentType: fallbackContentType(safeName)
    };
  } catch {
    // Render disks can be reset or misconfigured. The database backup lets uploads survive deploys.
  }

  if (!config.useDatabase) return null;

  const storageKey = `uploads/${storageFolder}/${safeName}`;
  try {
    const rows = await query(`
      SELECT file_name AS fileName, content_type AS contentType, data
      FROM uploaded_media
      WHERE storage_key_hash = :storageKeyHash
      LIMIT 1
    `, { storageKeyHash: storageKeyHash(storageKey) });
    const media = rows[0];
    if (!media?.data) return null;
    return {
      fileName: media.fileName || safeName,
      buffer: Buffer.isBuffer(media.data) ? media.data : Buffer.from(media.data),
      contentType: media.contentType || fallbackContentType(safeName)
    };
  } catch (error) {
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error.code)) {
      return null;
    }
    throw error;
  }
}

async function listingMediaDownload(fileName) {
  return uploadMediaDownload(fileName, LISTING_MEDIA_UPLOAD_DIR, 'listing-media', contentTypeForListingImage);
}

async function customizationMediaDownload(fileName) {
  return uploadMediaDownload(fileName, CUSTOMIZATION_MEDIA_UPLOAD_DIR, 'customization-media', contentTypeForListingImage);
}

async function storeByVendorId(vendorId) {
  const rows = await query(`
    SELECT
      id,
      vendor_id AS vendorId,
      name,
      slug,
      summary,
      location,
      address_line_1 AS addressLine1,
      address_line_2 AS addressLine2,
      parish,
      latitude,
      longitude,
      status,
      rating,
      share_token AS shareToken
    FROM stores
    WHERE vendor_id = :vendorId
    ORDER BY created_at
    LIMIT 1
  `, { vendorId });
  const store = rows[0] || null;
  return store ? {
    ...store,
    latitude: store.latitude === null || store.latitude === undefined ? null : Number(store.latitude),
    longitude: store.longitude === null || store.longitude === undefined ? null : Number(store.longitude)
  } : null;
}

async function listVendorProducts(vendorIds) {
  if (!vendorIds.length) return [];
  const rows = await query(`
    SELECT
      p.id,
      p.store_id AS storeId,
      p.vendor_id AS vendorId,
      p.type,
      p.name,
      p.description,
      p.price_jmd AS price,
      p.stock_quantity AS stockQuantity,
      p.delivery_day AS deliveryDay,
      p.status,
      p.created_at AS createdAt,
      product_image.imageUrl,
      customization_image.imageUrl AS customizationImageUrl,
      discounts.discountIds,
      discounts.discountNames,
      customization_template.id AS customizationTemplateId,
      customization_template.status AS customizationTemplateStatus,
      feature.featuredUntil
    FROM products p
    ${primaryProductImageJoin()}
    ${primaryProductCustomizationImageJoin('customization_image', false)}
    LEFT JOIN product_customization_templates customization_template
      ON customization_template.product_id = p.id
    LEFT JOIN (
      SELECT
        dp.product_id AS productId,
        GROUP_CONCAT(d.id ORDER BY d.created_at DESC) AS discountIds,
        GROUP_CONCAT(d.name ORDER BY d.created_at DESC SEPARATOR ', ') AS discountNames
      FROM discount_products dp
      JOIN discounts d ON d.id = dp.discount_id AND d.status = 'active'
      GROUP BY dp.product_id
    ) discounts ON discounts.productId = p.id
    LEFT JOIN (
      SELECT product_id AS productId, MAX(ends_at) AS featuredUntil
      FROM product_features
      WHERE status = 'active' AND ends_at > NOW()
      GROUP BY product_id
    ) feature ON feature.productId = p.id
    WHERE FIND_IN_SET(p.vendor_id, :vendorIds)
    ORDER BY feature.featuredUntil IS NULL, p.created_at DESC
  `, { vendorIds: vendorIds.join(',') });

  return Promise.all(rows.map(async (row) => {
    const originalPrice = Number(row.price || 0);
    const discount = await bestDiscountForProduct(row, null, originalPrice);
    const price = discountedUnitPrice(originalPrice, discount);
    return {
      ...row,
      originalPrice,
      price,
      hasDiscount: price < originalPrice,
      discount: normalizeDiscount(discount),
      stockQuantity: Number(row.stockQuantity || 0),
      imageUrl: row.imageUrl || row.customizationImageUrl || '',
      featuredUntil: row.featuredUntil || null,
      isFeatured: Boolean(row.featuredUntil),
      isCustomizable: Boolean(row.customizationTemplateId)
    };
  }));
}

async function listVendorCartCustomers(vendorIds) {
  if (!vendorIds.length) return [];
  return query(`
    SELECT
      ci.vendor_id AS vendorId,
      c.id AS cartId,
      CONCAT('Cart ', UPPER(RIGHT(REPLACE(c.id, '-', ''), 6))) AS cartLabel,
      COUNT(DISTINCT ci.product_id) AS productCount,
      SUM(ci.quantity) AS itemCount,
      SUM(ci.quantity * ci.unit_price_jmd) AS cartTotal,
      GROUP_CONCAT(DISTINCT p.name ORDER BY ci.updated_at DESC SEPARATOR ', ') AS productNames,
      MIN(ci.created_at) AS oldestAddedAt,
      MAX(ci.updated_at) AS lastUpdatedAt,
      TIMESTAMPDIFF(HOUR, MIN(ci.created_at), NOW()) AS ageHours,
      COUNT(DISTINCT CASE WHEN dco.status = 'active' THEN dco.id END) AS activeOfferCount
    FROM cart_items ci
    JOIN carts c ON c.id = ci.cart_id AND c.status = 'active'
    JOIN products p ON p.id = ci.product_id
    LEFT JOIN discount_cart_offers dco ON dco.cart_id = c.id AND dco.vendor_id = ci.vendor_id AND dco.status = 'active'
    WHERE FIND_IN_SET(ci.vendor_id, :vendorIds)
    GROUP BY ci.vendor_id, c.id
    ORDER BY oldestAddedAt, lastUpdatedAt DESC
  `, { vendorIds: vendorIds.join(',') });
}

async function listVendorDiscounts(vendorIds) {
  if (!vendorIds.length) return [];
  return query(`
    SELECT
      d.id,
      d.vendor_id AS vendorId,
      d.store_id AS storeId,
      d.customer_user_id AS customerUserId,
      d.code,
      d.name,
      d.discount_type AS discountType,
      d.amount,
      d.scope,
      d.status,
      d.starts_at AS startsAt,
      d.ends_at AS endsAt,
      d.created_at AS createdAt,
      products.productIds,
      products.productNames,
      COALESCE(products.appliedProductCount, 0) AS appliedProductCount,
      COALESCE(cartOffers.activeCartOfferCount, 0) AS activeCartOfferCount
    FROM discounts d
    LEFT JOIN (
      SELECT
        dp.discount_id AS discountId,
        GROUP_CONCAT(p.id ORDER BY p.name) AS productIds,
        GROUP_CONCAT(p.name ORDER BY p.name SEPARATOR ', ') AS productNames,
        COUNT(*) AS appliedProductCount
      FROM discount_products dp
      JOIN products p ON p.id = dp.product_id
      GROUP BY dp.discount_id
    ) products ON products.discountId = d.id
    LEFT JOIN (
      SELECT discount_id AS discountId, COUNT(*) AS activeCartOfferCount
      FROM discount_cart_offers
      WHERE status = 'active' AND (expires_at IS NULL OR expires_at >= NOW())
      GROUP BY discount_id
    ) cartOffers ON cartOffers.discountId = d.id
    WHERE FIND_IN_SET(d.vendor_id, :vendorIds)
    ORDER BY d.created_at DESC
  `, { vendorIds: vendorIds.join(',') });
}

async function listVendorServices(vendorIds) {
  if (!vendorIds.length) return [];
  return query(`
    SELECT
      s.id,
      s.vendor_id AS vendorId,
      s.store_id AS storeId,
      s.name,
      s.category,
      s.description,
      s.details,
      s.price_jmd AS price,
      s.pricing_type AS pricingType,
      s.status,
      s.created_at AS createdAt,
      service_image.imageUrl
    FROM services s
    ${primaryServiceImageJoin()}
    WHERE FIND_IN_SET(s.vendor_id, :vendorIds)
    ORDER BY s.created_at DESC
  `, { vendorIds: vendorIds.join(',') });
}

async function listVendorJobs(vendorIds) {
  if (!vendorIds.length) return [];
  return query(`
    SELECT id, vendor_id AS vendorId, title, employer_name AS employer, category, location, salary_jmd AS salary, COALESCE(NULLIF(salary_min_jmd, 0), salary_jmd) AS salaryMin, COALESCE(NULLIF(salary_max_jmd, 0), NULLIF(salary_min_jmd, 0), salary_jmd) AS salaryMax, job_type AS type, description, responsibilities, requirements, contact, status, deadline, created_at AS createdAt
    FROM jobs
    WHERE FIND_IN_SET(vendor_id, :vendorIds)
    ORDER BY created_at DESC
  `, { vendorIds: vendorIds.join(',') });
}

async function listVendorDocuments(vendorIds) {
  if (!vendorIds.length) return [];
  return query(`
    SELECT d.id, d.vendor_id AS vendorId, v.business_name AS vendor, d.document_type AS documentType, d.file_url AS fileUrl, d.status, d.created_at AS createdAt, d.reviewed_at AS reviewedAt
    FROM vendor_documents d
    JOIN vendors v ON v.id = d.vendor_id
    WHERE FIND_IN_SET(d.vendor_id, :vendorIds)
    ORDER BY d.created_at DESC
  `, { vendorIds: vendorIds.join(',') });
}

async function listStoreMedia(storeIds) {
  if (!storeIds.length) return [];
  return query(`
    SELECT id, store_id AS storeId, media_type AS mediaType, url, alt_text AS altText, sort_order AS sortOrder, created_at AS createdAt
    FROM store_media
    WHERE FIND_IN_SET(store_id, :storeIds)
    ORDER BY sort_order, created_at
  `, { storeIds: storeIds.join(',') });
}

async function listStoreSocialLinks(storeIds, activeOnly = false) {
  if (!storeIds.length) return [];
  const rows = await query(`
    SELECT id, store_id AS storeId, platform, label, url, status, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
    FROM store_social_links
    WHERE FIND_IN_SET(store_id, :storeIds)
      ${activeOnly ? "AND status = 'active'" : ''}
    ORDER BY sort_order, platform
  `, { storeIds: storeIds.join(',') });

  return rows.map((row) => ({
    ...row,
    sortOrder: Number(row.sortOrder || 0)
  }));
}

async function vendorOperationsForUser(userId, includeAll = false) {
  const vendorIds = includeAll ? (await listVendors()).map((vendor) => vendor.id) : await vendorIdsForUser(userId);
  const vendors = (await listVendors()).filter((vendor) => vendorIds.includes(vendor.id));
  const stores = (await Promise.all(vendorIds.map(storeByVendorId))).filter(Boolean);
  const storeIds = stores.map((store) => store.id);
  const [products, customizationTemplates, services, jobs, documents, media, socialLinks, registrationRequests, notifications, cartCustomers, discounts, orders, bookings, wallets, walletLedger, checkoutRequests, payoutProfiles, walletAudit] = await Promise.all([
    listVendorProducts(vendorIds),
    listCustomizationTemplates({ vendorIds }),
    listVendorServices(vendorIds),
    listVendorJobs(vendorIds),
    listVendorDocuments(vendorIds),
    listStoreMedia(storeIds),
    listStoreSocialLinks(storeIds),
    includeAll ? listRegistrationRequests() : query(`
      SELECT r.id, r.vendor_id AS vendorId, v.business_name AS vendor, r.status, r.notes AS nextStep, r.created_at AS requestedAt
      FROM registration_assistance_requests r
      JOIN vendors v ON v.id = r.vendor_id
      WHERE FIND_IN_SET(r.vendor_id, :vendorIds)
      ORDER BY r.created_at DESC
    `, { vendorIds: vendorIds.join(',') })
    ,
    listNotificationsForVendorIds(vendorIds),
    listVendorCartCustomers(vendorIds),
    listVendorDiscounts(vendorIds),
    listVendorOrders(vendorIds),
    listVendorBookings(vendorIds),
    listVendorWallets(vendorIds),
    listVendorWalletLedger(vendorIds),
    listVendorCheckoutRequests(vendorIds),
    listVendorPayoutProfiles(vendorIds),
    includeAll ? listWalletAuditReport(vendorIds) : []
  ]);

  return { vendors, stores, products, customizationTemplates, services, jobs, documents, media, socialLinks, registrationRequests, notifications, cartCustomers, discounts, orders, bookings, wallets, walletLedger, checkoutRequests, payoutProfiles, walletAudit };
}

async function updateStore(vendorId, body) {
  const store = await storeByVendorId(vendorId);
  if (!store) {
    const error = new Error('Store not found');
    error.statusCode = 404;
    throw error;
  }
  const name = String(body.name || store.name);
  const latitude = body.latitude === undefined ? store.latitude : coordinateOrNull(body.latitude, -90, 90);
  const longitude = body.longitude === undefined ? store.longitude : coordinateOrNull(body.longitude, -180, 180);
  await query(`
    UPDATE stores
    SET
      name = :name,
      slug = :slug,
      summary = :summary,
      location = :location,
      address_line_1 = :addressLine1,
      address_line_2 = :addressLine2,
      parish = :parish,
      latitude = :latitude,
      longitude = :longitude,
      status = :status
    WHERE id = :storeId
  `, {
    storeId: store.id,
    name,
    slug: body.slug ? slugFor(body.slug) : store.slug,
    summary: body.summary ?? store.summary,
    location: body.location ?? store.location,
    addressLine1: body.addressLine1 ?? store.addressLine1 ?? null,
    addressLine2: body.addressLine2 ?? store.addressLine2 ?? null,
    parish: body.parish ?? store.parish ?? null,
    latitude,
    longitude,
    status: ['draft', 'active', 'paused', 'suspended'].includes(body.status) ? body.status : store.status
  });
  return await storeByVendorId(vendorId);
}

async function createProduct(body) {
  const vendor = await findVendorById(body.vendorId);
  if (!vendor) {
    const error = new Error('Product requires a valid vendor');
    error.statusCode = 400;
    throw error;
  }

  const status = body.status === 'draft' || body.status === 'Draft' ? 'draft' : 'published';
  const id = `p${Date.now()}`;
  const storeId = body.storeId || await defaultStoreIdForVendor(vendor.id);
  if (status === 'published') {
    assertPublishAllowed(vendor, 'publish products');
    await assertStorePublishAllowed(storeId, vendor.id, 'publish products');
  }
  await query(`
    INSERT INTO products (id, store_id, vendor_id, type, name, description, price_jmd, stock_quantity, delivery_day, status)
    VALUES (:id, :storeId, :vendorId, :type, :name, :description, :price, :stockQuantity, :deliveryDay, :status)
  `, {
    id,
    storeId,
    vendorId: vendor.id,
    type: body.type === 'food' ? 'food' : 'product',
    name: body.name || 'New product',
    description: body.description || null,
    price: Number(body.price) || 0,
    stockQuantity: Math.max(0, Math.floor(Number(body.stockQuantity) || 0)),
    deliveryDay: body.deliveryDay || 'TBD',
    status
  });

  return { id, name: body.name || 'New product', vendorId: vendor.id, type: body.type === 'food' ? 'food' : 'product', price: Number(body.price) || 0, stockQuantity: Math.max(0, Math.floor(Number(body.stockQuantity) || 0)), deliveryDay: body.deliveryDay || 'TBD', status };
}

async function updateProduct(productId, body) {
  const rows = await query('SELECT * FROM products WHERE id = :productId LIMIT 1', { productId });
  const product = rows[0];
  if (!product) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    throw error;
  }
  const vendor = await findVendorById(product.vendor_id);
  const status = ['draft', 'published', 'paused', 'rejected'].includes(body.status) ? body.status : product.status;
  if (status === 'published') {
    assertPublishAllowed(vendor, 'publish products');
    await assertStorePublishAllowed(product.store_id, product.vendor_id, 'publish products');
  }
  await query(`
    UPDATE products
    SET name = :name, description = :description, price_jmd = :price, stock_quantity = :stockQuantity, delivery_day = :deliveryDay, type = :type, status = :status
    WHERE id = :productId
  `, {
    productId,
    name: body.name ?? product.name,
    description: body.description ?? product.description,
    price: Number(body.price ?? product.price_jmd) || 0,
    stockQuantity: Math.max(0, Math.floor(Number(body.stockQuantity ?? product.stock_quantity) || 0)),
    deliveryDay: body.deliveryDay ?? product.delivery_day,
    type: ['product', 'food'].includes(body.type) ? body.type : product.type,
    status
  });
  return (await listVendorProducts([product.vendor_id])).find((item) => item.id === productId);
}

async function createDiscount(body) {
  const vendor = await findVendorById(body.vendorId);
  if (!vendor) {
    const error = new Error('Discount requires a valid vendor');
    error.statusCode = 400;
    throw error;
  }

  const id = randomUUID();
  const scope = ['store', 'product', 'customer'].includes(body.scope) ? body.scope : 'product';
  const discountType = body.discountType === 'fixed' ? 'fixed' : 'percent';
  const amount = Math.max(1, Math.floor(Number(body.amount) || 0));
  if (discountType === 'percent' && amount > 100) {
    const error = new Error('Percent discounts cannot be greater than 100');
    error.statusCode = 400;
    throw error;
  }

  const storeId = body.storeId || await defaultStoreIdForVendor(vendor.id);
  await query(`
    INSERT INTO discounts (id, vendor_id, store_id, customer_user_id, code, name, discount_type, amount, scope, starts_at, ends_at, status)
    VALUES (:id, :vendorId, :storeId, :customerUserId, :code, :name, :discountType, :amount, :scope, :startsAt, :endsAt, :status)
  `, {
    id,
    vendorId: vendor.id,
    storeId,
    customerUserId: scope === 'customer' ? body.customerUserId || null : null,
    code: body.code || null,
    name: body.name || 'Store discount',
    discountType,
    amount,
    scope,
    startsAt: body.startsAt || null,
    endsAt: body.endsAt || null,
    status: ['active', 'paused'].includes(body.status) ? body.status : 'active'
  });

  const productIds = Array.isArray(body.productIds) ? body.productIds.filter(Boolean) : [];
  for (const productId of productIds) {
    const productVendorId = await vendorIdForProduct(productId);
    if (productVendorId !== vendor.id) {
      const error = new Error('Discount can only be applied to products from this vendor');
      error.statusCode = 403;
      throw error;
    }
    await query(`
      INSERT IGNORE INTO discount_products (discount_id, product_id)
      VALUES (:discountId, :productId)
    `, { discountId: id, productId });
  }

  return (await listVendorDiscounts([vendor.id])).find((discount) => discount.id === id);
}

async function vendorIdForDiscount(discountId) {
  const rows = await query('SELECT vendor_id AS vendorId FROM discounts WHERE id = :discountId LIMIT 1', { discountId });
  return rows[0]?.vendorId || null;
}

async function updateDiscountStatus(discountId, body) {
  const status = ['active', 'paused', 'expired'].includes(body.status) ? body.status : null;
  if (!status) {
    const error = new Error('Discount status update requires active, paused, or expired');
    error.statusCode = 400;
    throw error;
  }
  await query('UPDATE discounts SET status = :status WHERE id = :discountId', { discountId, status });
  const vendorId = await vendorIdForDiscount(discountId);
  if (!vendorId) {
    const error = new Error('Discount not found');
    error.statusCode = 404;
    throw error;
  }
  return (await listVendorDiscounts([vendorId])).find((discount) => discount.id === discountId);
}

async function deleteDiscount(discountId) {
  const vendorId = await vendorIdForDiscount(discountId);
  if (!vendorId) {
    const error = new Error('Discount not found');
    error.statusCode = 404;
    throw error;
  }
  await query('DELETE FROM discounts WHERE id = :discountId', { discountId });
  return { id: discountId, vendorId, deleted: true };
}

async function applyDiscountToProduct(productId, discountId) {
  const [productVendorId, discountVendorId] = await Promise.all([vendorIdForProduct(productId), vendorIdForDiscount(discountId)]);
  if (!productVendorId) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    throw error;
  }
  if (!discountVendorId) {
    const error = new Error('Discount not found');
    error.statusCode = 404;
    throw error;
  }
  if (productVendorId !== discountVendorId) {
    const error = new Error('Discount can only be applied to products from the same vendor');
    error.statusCode = 403;
    throw error;
  }
  await query('UPDATE discounts SET scope = "product" WHERE id = :discountId AND scope <> "store"', { discountId });
  await query('INSERT IGNORE INTO discount_products (discount_id, product_id) VALUES (:discountId, :productId)', { discountId, productId });
  return (await listVendorProducts([productVendorId])).find((product) => product.id === productId);
}

async function removeDiscountFromProduct(productId, discountId) {
  const [productVendorId, discountVendorId] = await Promise.all([vendorIdForProduct(productId), vendorIdForDiscount(discountId)]);
  if (!productVendorId || !discountVendorId) {
    const error = new Error('Product or discount not found');
    error.statusCode = 404;
    throw error;
  }
  if (productVendorId !== discountVendorId) {
    const error = new Error('Discount can only be removed from products from the same vendor');
    error.statusCode = 403;
    throw error;
  }
  await query('DELETE FROM discount_products WHERE discount_id = :discountId AND product_id = :productId', { discountId, productId });
  return (await listVendorProducts([productVendorId])).find((product) => product.id === productId);
}

async function offerDiscountToCart(cartId, vendorId, discountId, body = {}) {
  const discountVendorId = await vendorIdForDiscount(discountId);
  if (!discountVendorId) {
    const error = new Error('Discount not found');
    error.statusCode = 404;
    throw error;
  }
  if (discountVendorId !== vendorId) {
    const error = new Error('Vendor account cannot offer this discount');
    error.statusCode = 403;
    throw error;
  }

  const cartRows = await query(`
    SELECT c.id
    FROM carts c
    JOIN cart_items ci ON ci.cart_id = c.id
    WHERE c.id = :cartId AND c.status = 'active' AND ci.vendor_id = :vendorId
    LIMIT 1
  `, { cartId, vendorId });
  if (!cartRows[0]) {
    const error = new Error('Active cart not found for this vendor');
    error.statusCode = 404;
    throw error;
  }

  const id = randomUUID();
  await query(`
    INSERT INTO discount_cart_offers (id, discount_id, cart_id, vendor_id, expires_at)
    VALUES (:id, :discountId, :cartId, :vendorId, :expiresAt)
    ON DUPLICATE KEY UPDATE status = 'active', expires_at = VALUES(expires_at), offered_at = CURRENT_TIMESTAMP
  `, {
    id,
    discountId,
    cartId,
    vendorId,
    expiresAt: body.expiresAt || null
  });

  return (await listVendorCartCustomers([vendorId])).find((cart) => cart.cartId === cartId);
}

async function updateProductStock(productId, body) {
  const rows = await query('SELECT vendor_id AS vendorId FROM products WHERE id = :productId LIMIT 1', { productId });
  if (!rows[0]) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    throw error;
  }
  const stockQuantity = Math.max(0, Math.floor(Number(body.stockQuantity) || 0));
  await query('UPDATE products SET stock_quantity = :stockQuantity WHERE id = :productId', { productId, stockQuantity });
  return (await listVendorProducts([rows[0].vendorId])).find((item) => item.id === productId);
}

async function createProductImage(productId, body) {
  const id = randomUUID();
  const url = await saveListingImageUpload(id, body);
  if (!url) {
    const error = new Error('Choose a listing photo or provide a media URL');
    error.statusCode = 400;
    throw error;
  }
  if (body.makePrimary) {
    await query('UPDATE product_images SET sort_order = sort_order + 1 WHERE product_id = :productId', { productId });
  }
  await query(`
    INSERT INTO product_images (id, product_id, url, alt_text, sort_order)
    VALUES (:id, :productId, :url, :altText, :sortOrder)
  `, {
    id,
    productId,
    url,
    altText: body.altText || null,
    sortOrder: body.makePrimary ? 0 : Number(body.sortOrder) || 0
  });
  return { id, productId, url, altText: body.altText || '', sortOrder: body.makePrimary ? 0 : Number(body.sortOrder) || 0 };
}

async function createStoreMedia(storeId, body) {
  const id = randomUUID();
  const mediaType = ['logo', 'banner', 'gallery'].includes(body.mediaType) ? body.mediaType : 'gallery';
  const url = await saveListingImageUpload(id, body);
  if (!url) {
    const error = new Error('Choose a store media image or provide a media URL');
    error.statusCode = 400;
    throw error;
  }
  await query(`
    INSERT INTO store_media (id, store_id, media_type, url, alt_text, sort_order)
    VALUES (:id, :storeId, :mediaType, :url, :altText, :sortOrder)
  `, {
    id,
    storeId,
    mediaType,
    url,
    altText: body.altText || null,
    sortOrder: Number(body.sortOrder) || 0
  });
  return { id, storeId, mediaType, url, altText: body.altText || '', sortOrder: Number(body.sortOrder) || 0 };
}

function normalizeSocialPlatform(value) {
  const platform = String(value || '').toLowerCase().trim();
  if (!STORE_SOCIAL_PLATFORMS.has(platform)) {
    const error = new Error('Choose a supported social platform');
    error.statusCode = 400;
    throw error;
  }
  return platform;
}

function ensureHttps(value) {
  const text = String(value || '').trim();
  if (/^https?:\/\//i.test(text)) return text;
  return `https://${text.replace(/^\/+/, '')}`;
}

function socialHandle(value) {
  return String(value || '').trim().replace(/^@+/, '').replace(/^\/+/, '');
}

function normalizeSocialUrl(platform, value) {
  const raw = String(value || '').trim();
  if (!raw) {
    const error = new Error('Social account requires a URL, handle, or phone number');
    error.statusCode = 400;
    throw error;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  if (platform === 'whatsapp') {
    const phone = raw.replace(/[^\d]/g, '');
    if (!phone) {
      const error = new Error('WhatsApp link requires a phone number or wa.me URL');
      error.statusCode = 400;
      throw error;
    }
    return `https://wa.me/${phone}`;
  }
  if (platform === 'website' || raw.includes('.') || raw.includes('/')) {
    return ensureHttps(raw);
  }
  const handle = encodeURIComponent(socialHandle(raw));
  return {
    facebook: `https://www.facebook.com/${handle}`,
    instagram: `https://www.instagram.com/${handle}`,
    tiktok: `https://www.tiktok.com/@${handle}`,
    x: `https://x.com/${handle}`,
    youtube: `https://www.youtube.com/@${handle}`
  }[platform] || ensureHttps(raw);
}

function defaultSocialLabel(platform, value) {
  const labels = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    whatsapp: 'WhatsApp',
    tiktok: 'TikTok',
    x: 'X',
    youtube: 'YouTube',
    website: 'Website'
  };
  return String(value || '').trim() || labels[platform] || 'Social link';
}

async function upsertStoreSocialLink(storeId, body) {
  const platform = normalizeSocialPlatform(body.platform);
  const url = normalizeSocialUrl(platform, body.url || body.handle || body.value);
  const status = body.status === 'hidden' ? 'hidden' : 'active';
  const id = randomUUID();
  await query(`
    INSERT INTO store_social_links (id, store_id, platform, label, url, status, sort_order)
    VALUES (:id, :storeId, :platform, :label, :url, :status, :sortOrder)
    ON DUPLICATE KEY UPDATE
      label = VALUES(label),
      url = VALUES(url),
      status = VALUES(status),
      sort_order = VALUES(sort_order)
  `, {
    id,
    storeId,
    platform,
    label: defaultSocialLabel(platform, body.label),
    url,
    status,
    sortOrder: Number(body.sortOrder) || 0
  });
  return (await listStoreSocialLinks([storeId])).find((link) => link.platform === platform);
}

async function deleteStoreSocialLink(storeId, platformValue) {
  const platform = normalizeSocialPlatform(platformValue);
  await query('DELETE FROM store_social_links WHERE store_id = :storeId AND platform = :platform', { storeId, platform });
  return { storeId, platform, deleted: true };
}

async function createServiceImage(serviceId, body) {
  const id = randomUUID();
  const url = await saveListingImageUpload(id, body);
  if (!url) {
    const error = new Error('Choose a service photo or provide a media URL');
    error.statusCode = 400;
    throw error;
  }
  await query(`
    INSERT INTO service_images (id, service_id, url, alt_text, sort_order)
    VALUES (:id, :serviceId, :url, :altText, :sortOrder)
  `, {
    id,
    serviceId,
    url,
    altText: body.altText || null,
    sortOrder: Number(body.sortOrder) || 0
  });
  return { id, serviceId, url, altText: body.altText || '', sortOrder: Number(body.sortOrder) || 0 };
}

async function createService(body) {
  const vendor = await findVendorById(body.vendorId);
  if (!vendor) {
    const error = new Error('Service requires a valid vendor');
    error.statusCode = 400;
    throw error;
  }
  const status = body.status === 'draft' || body.status === 'Draft' ? 'draft' : 'published';
  const id = `svc-${Date.now()}`;
  const storeId = body.storeId || await defaultStoreIdForVendor(vendor.id);
  if (status === 'published') {
    assertPublishAllowed(vendor, 'publish services');
    await assertStorePublishAllowed(storeId, vendor.id, 'publish services');
  }
  await query(`
    INSERT INTO services (id, vendor_id, store_id, name, category, description, details, price_jmd, pricing_type, status)
    VALUES (:id, :vendorId, :storeId, :name, :category, :description, :details, :price, :pricingType, :status)
  `, {
    id,
    vendorId: vendor.id,
    storeId,
    name: body.name || 'New service',
    category: body.category || 'Local Services',
    description: body.description || null,
    details: body.details || null,
    price: Number(body.price) || 0,
    pricingType: body.pricingType || 'Fixed',
    status
  });
  return { id, vendorId: vendor.id, storeId, name: body.name || 'New service', category: body.category || 'Local Services', price: Number(body.price) || 0, pricingType: body.pricingType || 'Fixed', status };
}

async function updateService(serviceId, body) {
  const rows = await query('SELECT * FROM services WHERE id = :serviceId LIMIT 1', { serviceId });
  const service = rows[0];
  if (!service) {
    const error = new Error('Service not found');
    error.statusCode = 404;
    throw error;
  }
  const vendor = await findVendorById(service.vendor_id);
  const status = ['draft', 'published', 'paused', 'rejected'].includes(body.status) ? body.status : service.status;
  if (status === 'published') {
    assertPublishAllowed(vendor, 'publish services');
    await assertStorePublishAllowed(service.store_id, service.vendor_id, 'publish services');
  }
  await query(`
    UPDATE services
    SET name = :name, category = :category, description = :description, details = :details, price_jmd = :price, pricing_type = :pricingType, status = :status
    WHERE id = :serviceId
  `, {
    serviceId,
    name: body.name ?? service.name,
    category: body.category ?? service.category,
    description: body.description ?? service.description,
    details: body.details ?? service.details,
    price: Number(body.price ?? service.price_jmd) || 0,
    pricingType: body.pricingType ?? service.pricing_type,
    status
  });
  return (await listVendorServices([service.vendor_id])).find((item) => item.id === serviceId);
}

function serviceBookingQuery(whereClause = '', suffix = 'ORDER BY b.created_at DESC') {
  return `
    SELECT
      b.id,
      b.customer_user_id AS customerUserId,
      COALESCE(u.full_name, u.email, u.phone) AS customerName,
      COALESCE(u.email, u.phone) AS customerContact,
      b.service_id AS serviceId,
      s.name AS serviceName,
      s.category AS category,
      s.pricing_type AS pricingType,
      b.vendor_id AS vendorId,
      v.business_name AS vendorName,
      b.status,
      b.payment_status AS paymentStatus,
      pay.id AS paymentSessionId,
      pay.status AS paymentSessionStatus,
      pay.provider AS paymentProvider,
      pay.checkout_url AS paymentCheckoutUrl,
      b.booking_date AS date,
      b.booking_time AS time,
      b.location,
      b.notes,
      b.total_jmd AS total,
      CASE WHEN b.payment_status = 'paid' AND b.funds_released_at IS NULL THEN b.total_jmd ELSE 0 END AS heldCredits,
      CASE WHEN b.payment_status = 'paid' AND b.funds_released_at IS NOT NULL THEN b.total_jmd ELSE 0 END AS releasedCredits,
      b.vendor_completed_at AS vendorCompletedAt,
      b.customer_confirmed_at AS customerConfirmedAt,
      b.funds_released_at AS fundsReleasedAt,
      b.created_at AS bookedAt,
      b.updated_at AS updatedAt,
      COALESCE(disputes.openDisputeCount, 0) AS openDisputeCount,
      disputes.disputeStatus AS disputeStatus,
      CASE
        WHEN b.status = 'completed'
          AND b.customer_confirmed_at IS NULL
          AND COALESCE(disputes.openDisputeCount, 0) = 0
        THEN 1 ELSE 0
      END AS canConfirmCompletion,
      CASE
        WHEN b.payment_status <> 'paid' THEN 'awaiting_payment'
        WHEN COALESCE(disputes.openDisputeCount, 0) > 0 THEN 'disputed'
        WHEN b.funds_released_at IS NOT NULL THEN 'released'
        WHEN b.status = 'completed' AND b.customer_confirmed_at IS NULL THEN 'waiting_customer'
        ELSE 'held'
      END AS fundStatus
    FROM service_bookings b
    JOIN services s ON s.id = b.service_id
    JOIN vendors v ON v.id = b.vendor_id
    JOIN users u ON u.id = b.customer_user_id
    LEFT JOIN (
      SELECT ps.*
      FROM payment_sessions ps
      INNER JOIN (
        SELECT service_booking_id, MAX(created_at) AS max_created_at
        FROM payment_sessions
        WHERE service_booking_id IS NOT NULL
        GROUP BY service_booking_id
      ) latest ON latest.service_booking_id = ps.service_booking_id AND latest.max_created_at = ps.created_at
    ) pay ON pay.service_booking_id = b.id
    LEFT JOIN (
      SELECT
        service_booking_id AS serviceBookingId,
        COUNT(CASE WHEN status IN ('open', 'under_review') THEN 1 ELSE NULL END) AS openDisputeCount,
        GROUP_CONCAT(DISTINCT status ORDER BY status SEPARATOR ', ') AS disputeStatus
      FROM service_booking_disputes
      GROUP BY service_booking_id
    ) disputes ON disputes.serviceBookingId = b.id
    ${whereClause}
    ${suffix}
  `;
}

function normalizeBooking(row) {
  if (!row) return null;
  return {
    ...row,
    date: dateOnly(row.date),
    time: String(row.time || '').slice(0, 5),
    total: Number(row.total || 0),
    heldCredits: Number(row.heldCredits || 0),
    releasedCredits: Number(row.releasedCredits || 0),
    canConfirmCompletion: Boolean(row.canConfirmCompletion),
    hasOpenDispute: Number(row.openDisputeCount || 0) > 0,
    paymentSession: row.paymentSessionId ? {
      id: row.paymentSessionId,
      status: row.paymentSessionStatus,
      provider: row.paymentProvider,
      checkoutUrl: row.paymentCheckoutUrl,
      serviceBookingId: row.id
    } : null
  };
}

async function createBooking(body, customerUserId = null) {
  const service = await findServiceById(body.serviceId);
  const user = customerUserId ? await findUserById(customerUserId) : await findDefaultUser('customer');
  if (!service || !user || !body.date || !body.time || !body.location) {
    const error = new Error('Booking requires service, date, time, and location');
    error.statusCode = 400;
    throw error;
  }
  const serviceRows = await query('SELECT vendor_id AS vendorId FROM services WHERE id = :id LIMIT 1', { id: service.id });
  const vendorId = serviceRows[0]?.vendorId;
  if (!vendorId) {
    const error = new Error('Service vendor could not be found');
    error.statusCode = 400;
    throw error;
  }

  const id = `BKG-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const paymentSessionId = `PAY-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const total = Number(service.price) || 0;
  const checkout = buildServiceCheckout({
    sessionId: paymentSessionId,
    frontendOrigin: config.frontendOrigin,
    serviceId: service.id,
    bookingId: id
  });

  await transaction(async (tx) => {
    await tx.query(`
      INSERT INTO service_bookings (id, customer_user_id, service_id, vendor_id, status, payment_status, booking_date, booking_time, location, notes, total_jmd)
      VALUES (:id, :customerUserId, :serviceId, :vendorId, 'requested', 'pending', :date, :time, :location, :notes, :total)
    `, {
      id,
      customerUserId: user.id,
      serviceId: service.id,
      vendorId,
      date: body.date,
      time: body.time,
      location: body.location,
      notes: body.notes || null,
      total
    });
    await tx.query(`
      INSERT INTO payment_sessions (id, vendor_id, service_booking_id, provider, provider_session_id, status, amount_jmd, checkout_url, metadata)
      VALUES (:id, :vendorId, :bookingId, :provider, :providerSessionId, 'pending', :amount, :checkoutUrl, JSON_OBJECT('kind', 'service_booking', 'serviceId', :serviceId))
    `, {
      id: paymentSessionId,
      vendorId,
      bookingId: id,
      provider: checkout.provider,
      providerSessionId: checkout.providerSessionId,
      amount: total,
      checkoutUrl: checkout.checkoutUrl,
      serviceId: service.id
    });
  });

  return findBookingById(id, user.id);
}

async function findBookingById(bookingId, customerUserId = null) {
  const rows = await query(serviceBookingQuery(`
    WHERE b.id = :bookingId
      ${customerUserId ? 'AND b.customer_user_id = :customerUserId' : ''}
  `, 'LIMIT 1'), { bookingId, customerUserId });
  return normalizeBooking(rows[0]);
}

async function listBookings(customerUserId = null) {
  const rows = await query(serviceBookingQuery(customerUserId ? 'WHERE b.customer_user_id = :customerUserId' : ''), { customerUserId });
  return rows.map(normalizeBooking);
}

async function listVendorBookings(vendorIds = []) {
  if (!vendorIds.length) return [];
  const rows = await query(serviceBookingQuery('WHERE FIND_IN_SET(b.vendor_id, :vendorIds)'), { vendorIds: vendorIds.join(',') });
  return rows.map(normalizeBooking);
}

async function vendorIdForBooking(bookingId) {
  const rows = await query('SELECT vendor_id AS vendorId FROM service_bookings WHERE id = :bookingId LIMIT 1', { bookingId });
  return rows[0]?.vendorId || null;
}

async function updateServiceBookingStatus(bookingId, vendorId, status) {
  const nextStatus = ['confirmed', 'in_progress', 'completed', 'cancelled'].includes(status) ? status : null;
  if (!nextStatus) {
    const error = new Error('Service booking update requires a valid status');
    error.statusCode = 400;
    throw error;
  }

  const rows = await query(`
    SELECT id, vendor_id AS vendorId, payment_status AS paymentStatus, status
    FROM service_bookings
    WHERE id = :bookingId
    LIMIT 1
  `, { bookingId });
  const booking = rows[0];
  if (!booking || (vendorId && booking.vendorId !== vendorId)) {
    const error = new Error('Service booking not found for this vendor');
    error.statusCode = 404;
    throw error;
  }
  if (['in_progress', 'completed'].includes(nextStatus) && booking.paymentStatus !== 'paid') {
    const error = new Error('Vendors can only start or complete services after payment is confirmed');
    error.statusCode = 409;
    throw error;
  }

  await query(`
    UPDATE service_bookings
    SET
      status = :status,
      vendor_completed_at = CASE
        WHEN :status = 'completed' THEN COALESCE(vendor_completed_at, CURRENT_TIMESTAMP)
        ELSE vendor_completed_at
      END
    WHERE id = :bookingId
  `, { bookingId, status: nextStatus });
  if (nextStatus === 'completed') {
    await releaseEligibleServiceBookingFunds(bookingId);
    await safelyNotify(() => notifyServiceCompleted(bookingId));
  }
  return findBookingById(bookingId);
}

async function confirmServiceBookingCompleted(bookingId, customerUserId, allowAdmin = false) {
  const rows = await query(`
    SELECT id, status
    FROM service_bookings
    WHERE id = :bookingId
      ${allowAdmin ? '' : 'AND customer_user_id = :customerUserId'}
    LIMIT 1
  `, { bookingId, customerUserId });
  const booking = rows[0];
  if (!booking) {
    const error = new Error('Service booking not found for this customer');
    error.statusCode = 404;
    throw error;
  }

  const disputeRows = await query(`
    SELECT id
    FROM service_booking_disputes
    WHERE service_booking_id = :bookingId AND status IN ('open', 'under_review')
    LIMIT 1
  `, { bookingId });
  if (disputeRows[0]) {
    const error = new Error('Service completion cannot be confirmed while an issue is open');
    error.statusCode = 409;
    throw error;
  }
  if (booking.status !== 'completed' && booking.status !== 'customer_confirmed') {
    const error = new Error('The vendor must mark this service completed before customer confirmation');
    error.statusCode = 409;
    throw error;
  }

  const result = await query(`
    UPDATE service_bookings
    SET customer_confirmed_at = COALESCE(customer_confirmed_at, CURRENT_TIMESTAMP)
    WHERE id = :bookingId AND customer_confirmed_at IS NULL
  `, { bookingId });
  if (result.affectedRows < 1) {
    await releaseEligibleServiceBookingFunds(bookingId);
    return findBookingById(bookingId, allowAdmin ? null : customerUserId);
  }
  await releaseEligibleServiceBookingFunds(bookingId);
  await safelyNotify(() => notifyServiceCompletionConfirmed(bookingId));
  return findBookingById(bookingId, allowAdmin ? null : customerUserId);
}

async function createServiceBookingDispute(bookingId, body = {}, createdByUserId, role = 'customer') {
  const rows = await query(`
    SELECT id, customer_user_id AS customerUserId, vendor_id AS vendorId
    FROM service_bookings
    WHERE id = :bookingId
    LIMIT 1
  `, { bookingId });
  const booking = rows[0];
  if (!booking) {
    const error = new Error('Service booking not found');
    error.statusCode = 404;
    throw error;
  }
  if (role === 'customer' && booking.customerUserId !== createdByUserId) {
    const error = new Error('Customer account cannot report an issue for this service booking');
    error.statusCode = 403;
    throw error;
  }

  const reason = ['customer_reported_issue', 'service_not_provided', 'quality_issue', 'late_completion', 'admin_review'].includes(body.reason)
    ? body.reason
    : role === 'admin'
      ? 'admin_review'
      : 'customer_reported_issue';
  const existingRows = await query(`
    SELECT id, service_booking_id AS serviceBookingId, customer_user_id AS customerUserId, vendor_id AS vendorId, reason, status, notes, created_at AS createdAt, updated_at AS updatedAt
    FROM service_booking_disputes
    WHERE service_booking_id = :bookingId
      AND status IN ('open', 'under_review')
    LIMIT 1
  `, { bookingId });
  if (existingRows[0]) return existingRows[0];

  const id = randomUUID();
  await query(`
    INSERT INTO service_booking_disputes (
      id,
      service_booking_id,
      customer_user_id,
      vendor_id,
      created_by_user_id,
      reason,
      status,
      notes
    )
    VALUES (:id, :bookingId, :customerUserId, :vendorId, :createdByUserId, :reason, 'open', :notes)
  `, {
    id,
    bookingId,
    customerUserId: booking.customerUserId,
    vendorId: booking.vendorId,
    createdByUserId,
    reason,
    notes: body.notes || null
  });
  await query(`
    UPDATE service_bookings
    SET status = 'disputed'
    WHERE id = :bookingId AND status NOT IN ('cancelled', 'customer_confirmed')
  `, { bookingId });
  const createdRows = await query(`
    SELECT id, service_booking_id AS serviceBookingId, customer_user_id AS customerUserId, vendor_id AS vendorId, reason, status, notes, created_at AS createdAt, updated_at AS updatedAt
    FROM service_booking_disputes
    WHERE id = :id
    LIMIT 1
  `, { id });
  await safelyNotify(() => notifyServiceDisputeCreated(bookingId));
  return createdRows[0];
}

async function createJob(body, postedByUserId = null) {
  const user = postedByUserId ? await findUserById(postedByUserId) : await findDefaultUser('vendor') || await findDefaultUser('admin');
  if (!user || !body.title || !body.employer || !body.location || !body.description) {
    const error = new Error('Job requires title, employer, location, and description');
    error.statusCode = 400;
    throw error;
  }
  const id = `jm${Date.now()}`;
  await query(`
    INSERT INTO jobs (id, vendor_id, posted_by_user_id, title, employer_name, category, location, salary_jmd, salary_min_jmd, salary_max_jmd, job_type, description, responsibilities, requirements, contact, status, deadline)
    VALUES (:id, :vendorId, :postedByUserId, :title, :employer, :category, :location, :salary, :salaryMin, :salaryMax, :type, :description, :responsibilities, :requirements, :contact, :status, :deadline)
  `, {
    id,
    vendorId: body.vendorId || await defaultVendorIdForUser(user.id),
    postedByUserId: user.id,
    title: body.title,
    employer: body.employer,
    category: body.category || 'Other',
    location: body.location,
    salary: Number(body.salaryMin ?? body.salary) || 0,
    salaryMin: Number(body.salaryMin ?? body.salary) || 0,
    salaryMax: Math.max(Number(body.salaryMin ?? body.salary) || 0, Number(body.salaryMax ?? body.salaryMin ?? body.salary) || 0),
    type: body.type || 'Contract',
    description: body.description,
    responsibilities: JSON.stringify(body.responsibilities || []),
    requirements: JSON.stringify(body.requirements || []),
    contact: body.contact || '',
    status: body.status === 'Draft' ? 'draft' : 'pending_approval',
    deadline: body.deadline || null
  });
  return await findJobById(id);
}

async function updateJob(jobId, body) {
  const rows = await query('SELECT * FROM jobs WHERE id = :jobId LIMIT 1', { jobId });
  const job = rows[0];
  if (!job) {
    const error = new Error('Job not found');
    error.statusCode = 404;
    throw error;
  }
  await query(`
    UPDATE jobs
    SET title = :title, employer_name = :employer, category = :category, location = :location, salary_jmd = :salary, salary_min_jmd = :salaryMin, salary_max_jmd = :salaryMax, job_type = :type, description = :description, responsibilities = :responsibilities, requirements = :requirements, contact = :contact, status = :status, deadline = :deadline
    WHERE id = :jobId
  `, {
    jobId,
    title: body.title ?? job.title,
    employer: body.employer ?? job.employer_name,
    category: body.category ?? job.category,
    location: body.location ?? job.location,
    salary: Number(body.salaryMin ?? body.salary ?? job.salary_min_jmd ?? job.salary_jmd) || 0,
    salaryMin: Number(body.salaryMin ?? body.salary ?? job.salary_min_jmd ?? job.salary_jmd) || 0,
    salaryMax: Math.max(Number(body.salaryMin ?? body.salary ?? job.salary_min_jmd ?? job.salary_jmd) || 0, Number(body.salaryMax ?? job.salary_max_jmd ?? body.salaryMin ?? body.salary ?? job.salary_jmd) || 0),
    type: body.type ?? job.job_type,
    description: body.description ?? job.description,
    responsibilities: JSON.stringify(body.responsibilities || asJsonArray(job.responsibilities)),
    requirements: JSON.stringify(body.requirements || asJsonArray(job.requirements)),
    contact: body.contact ?? job.contact,
    status: ['draft', 'pending_approval', 'published', 'closed', 'rejected'].includes(body.status) ? body.status : job.status,
    deadline: body.deadline ?? dateOnly(job.deadline)
  });
  return (await listJobs(false)).find((item) => item.id === jobId);
}

async function createApplication(jobId, body, applicantUserId = null) {
  const job = await findPublicJobById(jobId);
  const user = applicantUserId ? await findUserById(applicantUserId) : await findDefaultUser('customer');
  if (!job || !user || !body.applicantName || !body.phone) {
    const error = new Error('Application requires job, applicant name, and phone');
    error.statusCode = 400;
    throw error;
  }
  if (!body.resumeDataBase64) {
    const error = new Error('Application requires a PDF resume upload');
    error.statusCode = 400;
    throw error;
  }
  const id = `APP-${Date.now()}`;
  const resumeUrl = await saveResumeUpload(id, body);
  await query(`
    INSERT INTO job_applications (id, job_id, applicant_user_id, applicant_name, phone, resume_url, message, status)
    VALUES (:id, :jobId, :userId, :applicantName, :phone, :resumeUrl, :message, 'pending')
    ON DUPLICATE KEY UPDATE message = VALUES(message), phone = VALUES(phone), resume_url = VALUES(resume_url), status = 'pending'
  `, {
    id,
    jobId,
    userId: user.id,
    applicantName: body.applicantName,
    phone: body.phone,
    resumeUrl,
    message: body.message || null
  });
  return { id, jobId, jobTitle: job.title, employer: job.employer, applicantName: body.applicantName, phone: body.phone, resumeName: body.resumeName || 'Resume attached', resumeUrl, message: body.message || '', status: 'Pending', appliedAt: new Date().toISOString() };
}

async function listApplications() {
  return query(`
    SELECT a.id, a.job_id AS jobId, j.title AS jobTitle, j.employer_name AS employer, a.applicant_name AS applicantName, a.phone, SUBSTRING_INDEX(a.resume_url, '/', -1) AS resumeName, a.resume_url AS resumeUrl, a.message, a.status, a.created_at AS appliedAt
    FROM job_applications a
    JOIN jobs j ON j.id = a.job_id
    ORDER BY a.created_at DESC
  `);
}

async function listApplicationsForUser(customerUserId) {
  return query(`
    SELECT a.id, a.job_id AS jobId, j.title AS jobTitle, j.employer_name AS employer, a.applicant_name AS applicantName, a.phone, SUBSTRING_INDEX(a.resume_url, '/', -1) AS resumeName, a.resume_url AS resumeUrl, a.message, a.status, a.created_at AS appliedAt
    FROM job_applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.applicant_user_id = :customerUserId
    ORDER BY a.created_at DESC
  `, { customerUserId });
}

async function listCustomerAddresses(customerUserId) {
  const rows = await query(`
    SELECT
      id,
      label,
      recipient_name AS recipientName,
      phone,
      address_line_1 AS addressLine1,
      address_line_2 AS addressLine2,
      parish,
      latitude,
      longitude,
      notes,
      is_default AS isDefault,
      created_at AS createdAt
    FROM customer_addresses
    WHERE customer_user_id = :customerUserId
    ORDER BY is_default DESC, created_at DESC
  `, { customerUserId });
  return rows.map((row) => ({
    ...row,
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude)
  }));
}

async function createCustomerAddress(customerUserId, body) {
  const id = randomUUID();
  if (body.isDefault) {
    await query('UPDATE customer_addresses SET is_default = FALSE WHERE customer_user_id = :customerUserId', { customerUserId });
  }
  await query(`
    INSERT INTO customer_addresses (id, customer_user_id, label, recipient_name, phone, address_line_1, address_line_2, parish, latitude, longitude, notes, is_default)
    VALUES (:id, :customerUserId, :label, :recipientName, :phone, :addressLine1, :addressLine2, :parish, :latitude, :longitude, :notes, :isDefault)
  `, {
    id,
    customerUserId,
    label: body.label || 'Default',
    recipientName: body.recipientName || body.name || null,
    phone: body.phone || null,
    addressLine1: body.addressLine1 || body.address || 'Address pending',
    addressLine2: body.addressLine2 || null,
    parish: body.parish || null,
    latitude: coordinateOrNull(body.latitude, -90, 90),
    longitude: coordinateOrNull(body.longitude, -180, 180),
    notes: body.notes || null,
    isDefault: Boolean(body.isDefault)
  });
  return (await listCustomerAddresses(customerUserId)).find((address) => address.id === id);
}

async function createReview(customerUserId, body) {
  const reviewType = ['product', 'service', 'store'].includes(body.reviewType) ? body.reviewType : body.productId ? 'product' : body.serviceId ? 'service' : 'store';
  const vendorId = body.vendorId
    || await vendorIdForProduct(body.productId)
    || await vendorIdForService(body.serviceId)
    || await vendorIdForStore(body.storeId);
  if (!vendorId) {
    const error = new Error('Review requires a vendor, product, or service');
    error.statusCode = 400;
    throw error;
  }

  const storeId = body.storeId || await defaultStoreIdForVendor(vendorId);
  const [productRows, serviceRows, storeRows] = await Promise.all([
    reviewType === 'product' && body.productId ? query(`
      SELECT oi.id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.customer_user_id = :customerUserId
        AND oi.product_id = :productId
        AND oi.customer_received_at IS NOT NULL
      LIMIT 1
    `, { customerUserId, productId: body.productId }) : [],
    reviewType === 'service' && body.serviceId ? query(`
      SELECT id
      FROM service_bookings
      WHERE customer_user_id = :customerUserId AND service_id = :serviceId AND customer_confirmed_at IS NOT NULL
      LIMIT 1
    `, { customerUserId, serviceId: body.serviceId }) : []
    ,
    reviewType === 'store' && storeId ? query(`
      SELECT id
      FROM (
        SELECT oi.id
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.customer_user_id = :customerUserId
          AND oi.store_id = :storeId
          AND oi.customer_received_at IS NOT NULL
        UNION
        SELECT b.id
        FROM service_bookings b
        JOIN services s ON s.id = b.service_id
        WHERE b.customer_user_id = :customerUserId
          AND s.store_id = :storeId
          AND b.customer_confirmed_at IS NOT NULL
      ) reviewable_store
      LIMIT 1
    `, { customerUserId, storeId }) : []
  ]);

  const isAllowed = (reviewType === 'product' && productRows.length)
    || (reviewType === 'service' && serviceRows.length)
    || (reviewType === 'store' && storeRows.length);
  if (!isAllowed) {
    const error = new Error('Reviews are available after the customer has received this product, service, or store order');
    error.statusCode = 403;
    throw error;
  }

  const id = randomUUID();
  await query(`
    INSERT INTO reviews (id, customer_user_id, vendor_id, store_id, product_id, service_id, rating, comment, status)
    VALUES (:id, :customerUserId, :vendorId, :storeId, :productId, :serviceId, :rating, :comment, 'published')
  `, {
    id,
    customerUserId,
    vendorId,
    storeId,
    productId: reviewType === 'product' ? body.productId || null : null,
    serviceId: reviewType === 'service' ? body.serviceId || null : null,
    rating: Math.min(5, Math.max(1, Math.floor(Number(body.rating) || 5))),
    comment: body.comment || null
  });
  return {
    id,
    reviewType,
    vendorId,
    storeId,
    productId: reviewType === 'product' ? body.productId || null : null,
    serviceId: reviewType === 'service' ? body.serviceId || null : null,
    rating: Math.min(5, Math.max(1, Math.floor(Number(body.rating) || 5))),
    comment: body.comment || '',
    status: 'published'
  };
}

async function listReviewsForUser(customerUserId) {
  return query(`
    SELECT
      r.id,
      r.vendor_id AS vendorId,
      v.business_name AS vendorName,
      r.store_id AS storeId,
      st.name AS storeName,
      r.product_id AS productId,
      p.name AS productName,
      r.service_id AS serviceId,
      s.name AS serviceName,
      CASE
        WHEN r.product_id IS NOT NULL THEN 'product'
        WHEN r.service_id IS NOT NULL THEN 'service'
        ELSE 'store'
      END AS reviewType,
      r.rating,
      r.comment,
      r.status,
      r.created_at AS createdAt
    FROM reviews r
    JOIN vendors v ON v.id = r.vendor_id
    LEFT JOIN stores st ON st.id = r.store_id
    LEFT JOIN products p ON p.id = r.product_id
    LEFT JOIN services s ON s.id = r.service_id
    WHERE r.customer_user_id = :customerUserId
    ORDER BY r.created_at DESC
  `, { customerUserId });
}

async function listCustomerReviewTargets(customerUserId) {
  const [products, stores, services] = await Promise.all([
    query(`
      SELECT
        CONCAT('product:', p.id) AS targetKey,
        'product' AS targetType,
        p.id AS targetId,
        p.id AS productId,
        NULL AS serviceId,
        oi.store_id AS storeId,
        oi.vendor_id AS vendorId,
        p.name AS label,
        v.business_name AS vendorName,
        st.name AS storeName,
        MAX(oi.customer_received_at) AS receivedAt,
        MAX(r.id) AS reviewId
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      JOIN vendors v ON v.id = oi.vendor_id
      JOIN stores st ON st.id = oi.store_id
      LEFT JOIN reviews r
        ON r.customer_user_id = o.customer_user_id
        AND r.product_id = p.id
      WHERE o.customer_user_id = :customerUserId
        AND oi.customer_received_at IS NOT NULL
      GROUP BY p.id, oi.store_id, oi.vendor_id, p.name, v.business_name, st.name
      ORDER BY receivedAt DESC
    `, { customerUserId }),
    query(`
      SELECT
        CONCAT('store:', st.id) AS targetKey,
        'store' AS targetType,
        st.id AS targetId,
        NULL AS productId,
        NULL AS serviceId,
        st.id AS storeId,
        st.vendor_id AS vendorId,
        st.name AS label,
        v.business_name AS vendorName,
        st.name AS storeName,
        MAX(oi.customer_received_at) AS receivedAt,
        MAX(r.id) AS reviewId
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN stores st ON st.id = oi.store_id
      JOIN vendors v ON v.id = st.vendor_id
      LEFT JOIN reviews r
        ON r.customer_user_id = o.customer_user_id
        AND r.store_id = st.id
        AND r.product_id IS NULL
        AND r.service_id IS NULL
      WHERE o.customer_user_id = :customerUserId
        AND oi.customer_received_at IS NOT NULL
      GROUP BY st.id, st.vendor_id, st.name, v.business_name
      ORDER BY receivedAt DESC
    `, { customerUserId }),
    query(`
      SELECT
        CONCAT('service:', s.id) AS targetKey,
        'service' AS targetType,
        s.id AS targetId,
        NULL AS productId,
        s.id AS serviceId,
        s.store_id AS storeId,
        b.vendor_id AS vendorId,
        s.name AS label,
        v.business_name AS vendorName,
        st.name AS storeName,
        MAX(b.created_at) AS receivedAt,
        MAX(r.id) AS reviewId
      FROM service_bookings b
      JOIN services s ON s.id = b.service_id
      JOIN vendors v ON v.id = b.vendor_id
      LEFT JOIN stores st ON st.id = s.store_id
      LEFT JOIN reviews r
        ON r.customer_user_id = b.customer_user_id
        AND r.service_id = s.id
      WHERE b.customer_user_id = :customerUserId
        AND b.customer_confirmed_at IS NOT NULL
      GROUP BY s.id, s.store_id, b.vendor_id, s.name, v.business_name, st.name
      ORDER BY receivedAt DESC
    `, { customerUserId })
  ]);

  return [...products, ...stores, ...services]
    .map((target) => ({
      ...target,
      canReview: !target.reviewId,
      receivedAt: target.receivedAt || null
    }))
    .sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
}

async function customerDashboard(customerUserId) {
  const [orders, bookings, applications, addresses, reviews, reviewTargets, cart] = await Promise.all([
    listOrders(customerUserId),
    listBookings(customerUserId),
    listApplicationsForUser(customerUserId),
    listCustomerAddresses(customerUserId),
    listReviewsForUser(customerUserId),
    listCustomerReviewTargets(customerUserId),
    cartForUser(customerUserId)
  ]);
  return { orders, bookings, applications, addresses, reviews, reviewTargets, cart };
}

async function createRegistrationRequest(vendorSlug, requestedByUserId = null) {
  const vendor = await findVendorBySlug(vendorSlug);
  if (!vendor) {
    const error = new Error('Vendor not found');
    error.statusCode = 404;
    throw error;
  }
  const id = `REG-${Date.now()}`;
  await query(`
    INSERT INTO registration_assistance_requests (id, vendor_id, requested_by_user_id, status, notes)
    VALUES (:id, :vendorId, :requestedByUserId, 'requested', :notes)
  `, {
    id,
    vendorId: vendor.id,
    requestedByUserId,
    notes: 'Collect business name, TRN, owner ID, and Companies Office registration progress.'
  });
  return {
    id,
    vendorId: vendor.id,
    vendor: vendor.name,
    status: 'requested',
    requestedAt: new Date().toISOString(),
    nextStep: 'Collect business name, TRN, owner ID, and Companies Office registration progress.'
  };
}

async function listRegistrationRequests() {
  return query(`
    SELECT r.id, r.vendor_id AS vendorId, v.business_name AS vendor, r.status, r.notes AS nextStep, r.created_at AS requestedAt
    FROM registration_assistance_requests r
    JOIN vendors v ON v.id = r.vendor_id
    ORDER BY r.created_at DESC
  `);
}

async function listComplianceAlerts(includeResolved = false) {
  return query(`
    SELECT
      a.id,
      a.vendor_id AS vendorId,
      v.business_name AS vendorName,
      a.severity,
      a.alert_type AS alertType,
      a.message,
      a.due_date AS dueDate,
      a.resolved_at AS resolvedAt,
      a.created_at AS createdAt
    FROM compliance_alerts a
    JOIN vendors v ON v.id = a.vendor_id
    ${includeResolved ? '' : 'WHERE a.resolved_at IS NULL'}
    ORDER BY FIELD(a.severity, 'critical', 'warning', 'notice', 'ok'), a.due_date, a.created_at DESC
  `);
}

async function createComplianceAlertIfMissing({ vendorId, severity, alertType, message, dueDate }) {
  const rows = await query(`
    SELECT id
    FROM compliance_alerts
    WHERE vendor_id = :vendorId
      AND alert_type = :alertType
      AND resolved_at IS NULL
    LIMIT 1
  `, { vendorId, alertType });

  if (rows[0]) {
    return { id: rows[0].id, created: false };
  }

  const id = randomUUID();
  await query(`
    INSERT INTO compliance_alerts (id, vendor_id, severity, alert_type, message, due_date)
    VALUES (:id, :vendorId, :severity, :alertType, :message, :dueDate)
  `, { id, vendorId, severity, alertType, message, dueDate });
  return { id, created: true };
}

async function createVendorNotificationIfMissing({ vendorId, notificationType, title, message }) {
  const rows = await query(`
    SELECT id
    FROM notifications
    WHERE vendor_id = :vendorId
      AND notification_type = :notificationType
      AND read_at IS NULL
    LIMIT 1
  `, { vendorId, notificationType });

  if (rows[0]) {
    return { id: rows[0].id, created: false };
  }

  const id = randomUUID();
  await query(`
    INSERT INTO notifications (id, vendor_id, channel, notification_type, title, message, scheduled_for, sent_at)
    VALUES (:id, :vendorId, 'in_app', :notificationType, :title, :message, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, { id, vendorId, notificationType, title, message });
  return { id, created: true };
}

async function createUserNotificationIfMissing({ userId, notificationType, title, message }) {
  if (!userId) return { id: null, created: false };
  const rows = await query(`
    SELECT id
    FROM notifications
    WHERE user_id = :userId
      AND notification_type = :notificationType
      AND read_at IS NULL
    LIMIT 1
  `, { userId, notificationType });

  if (rows[0]) {
    return { id: rows[0].id, created: false };
  }

  const id = randomUUID();
  await query(`
    INSERT INTO notifications (id, user_id, channel, notification_type, title, message, scheduled_for, sent_at)
    VALUES (:id, :userId, 'in_app', :notificationType, :title, :message, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, { id, userId, notificationType, title, message });
  return { id, created: true };
}

async function listNotificationsForUserId(userId) {
  if (!userId) return [];
  return query(`
    SELECT id, user_id AS userId, vendor_id AS vendorId, channel, notification_type AS notificationType, title, message, scheduled_for AS scheduledFor, sent_at AS sentAt, read_at AS readAt, created_at AS createdAt
    FROM notifications
    WHERE user_id = :userId
    ORDER BY created_at DESC
  `, { userId });
}

async function notifyAdminUsers({ notificationType, title, message }) {
  const rows = await query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  await Promise.all(rows.map((row) => createUserNotificationIfMissing({
    userId: row.id,
    notificationType,
    title,
    message
  })));
}

async function safelyNotify(factory) {
  try {
    await factory();
  } catch {
    // Notifications should never block orders, payments, fulfillment, or payouts.
  }
}

function notificationSeverity(notificationType = '') {
  const type = String(notificationType);
  if (/(dispute|issue|mismatch|past_due|expired|rejected|failed)/.test(type)) return 'critical';
  if (/(confirm|fulfilled|completed|checkout|due|new_|waiting|large_held)/.test(type)) return 'warning';
  return 'notice';
}

function notificationToAlert(notification, audience, actionUrl) {
  return {
    id: `notification:${notification.id}`,
    audience,
    severity: notificationSeverity(notification.notificationType),
    type: notification.notificationType,
    title: notification.title,
    message: notification.message,
    actionLabel: 'Open',
    actionUrl,
    createdAt: notification.createdAt,
    readAt: notification.readAt
  };
}

async function notifyOrderPaymentConfirmed(orderId, sessionId) {
  const orderRows = await query(`
    SELECT customer_user_id AS customerUserId, total_jmd AS total
    FROM orders
    WHERE id = :orderId
    LIMIT 1
  `, { orderId });
  const order = orderRows[0];
  if (!order) return;

  await createUserNotificationIfMissing({
    userId: order.customerUserId,
    notificationType: `order_payment_confirmed:${orderId}`,
    title: 'Payment confirmed',
    message: `Payment for order ${orderId} is confirmed. Vendor credits are now held until delivery is confirmed.`
  });

  const vendorRows = await query(`
    SELECT oi.vendor_id AS vendorId, v.business_name AS vendorName, SUM(oi.quantity) AS itemCount, SUM(oi.line_total_jmd) AS vendorTotal
    FROM order_items oi
    JOIN vendors v ON v.id = oi.vendor_id
    WHERE oi.order_id = :orderId
    GROUP BY oi.vendor_id, v.business_name
  `, { orderId });
  await Promise.all(vendorRows.map((vendor) => createVendorNotificationIfMissing({
    vendorId: vendor.vendorId,
    notificationType: `new_paid_order:${orderId}:${vendor.vendorId}`,
    title: 'New paid order',
    message: `Order ${orderId} has ${Number(vendor.itemCount || 0)} item(s) for your store. ${Number(vendor.vendorTotal || 0)} credits are held until fulfillment and customer receipt.`
  })));

  await notifyAdminUsers({
    notificationType: `payment_session_paid:${sessionId}`,
    title: 'Customer payment confirmed',
    message: `Payment session ${sessionId} for order ${orderId} was confirmed.`
  });
}

async function notifyServicePaymentConfirmed(bookingId, sessionId) {
  const rows = await query(`
    SELECT
      b.customer_user_id AS customerUserId,
      b.vendor_id AS vendorId,
      b.total_jmd AS total,
      s.name AS serviceName
    FROM service_bookings b
    JOIN services s ON s.id = b.service_id
    WHERE b.id = :bookingId
    LIMIT 1
  `, { bookingId });
  const booking = rows[0];
  if (!booking) return;

  await createUserNotificationIfMissing({
    userId: booking.customerUserId,
    notificationType: `service_payment_confirmed:${bookingId}`,
    title: 'Service payment confirmed',
    message: `Payment for ${booking.serviceName} is confirmed. Vendor credits are held until you confirm completion.`
  });
  await createVendorNotificationIfMissing({
    vendorId: booking.vendorId,
    notificationType: `new_paid_service_booking:${bookingId}`,
    title: 'New paid service booking',
    message: `${booking.serviceName} has been paid. ${Number(booking.total || 0)} credits are held until completion is confirmed.`
  });
  await notifyAdminUsers({
    notificationType: `service_payment_session_paid:${sessionId}`,
    title: 'Service payment confirmed',
    message: `Payment session ${sessionId} for service booking ${bookingId} was confirmed.`
  });
}

async function notifySubscriptionPaymentConfirmed(vendorId, sessionId) {
  const vendor = await findVendorById(vendorId);
  if (!vendor) return;
  await createVendorNotificationIfMissing({
    vendorId,
    notificationType: `subscription_payment_confirmed:${sessionId}`,
    title: 'Subscription active',
    message: 'Your subscription payment was confirmed and your plan is active.'
  });
  await notifyAdminUsers({
    notificationType: `subscription_payment_confirmed:${sessionId}`,
    title: 'Vendor subscription paid',
    message: `${vendor.name} completed a subscription payment.`
  });
}

async function notifyOrderFulfilled(orderId, vendorId) {
  const rows = await query(`
    SELECT o.customer_user_id AS customerUserId, v.business_name AS vendorName, SUM(oi.line_total_jmd) AS vendorTotal
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN vendors v ON v.id = oi.vendor_id
    WHERE o.id = :orderId AND oi.vendor_id = :vendorId
    GROUP BY o.customer_user_id, v.business_name
  `, { orderId, vendorId });
  const order = rows[0];
  if (!order) return;
  await createUserNotificationIfMissing({
    userId: order.customerUserId,
    notificationType: `order_fulfilled:${orderId}:${vendorId}`,
    title: 'Order marked fulfilled',
    message: `${order.vendorName} marked their part of order ${orderId} fulfilled. Confirm receipt after you receive it.`
  });
}

async function notifyOrderReceiptConfirmed(orderId) {
  const orderRows = await query('SELECT customer_user_id AS customerUserId FROM orders WHERE id = :orderId LIMIT 1', { orderId });
  const order = orderRows[0];
  if (!order) return;
  await createUserNotificationIfMissing({
    userId: order.customerUserId,
    notificationType: `receipt_confirmed:${orderId}`,
    title: 'Receipt confirmed',
    message: `Receipt for order ${orderId} was confirmed. Held vendor credits were released.`
  });

  const vendorRows = await query(`
    SELECT oi.vendor_id AS vendorId, v.business_name AS vendorName, SUM(oi.line_total_jmd) AS releasedTotal
    FROM order_items oi
    JOIN vendors v ON v.id = oi.vendor_id
    WHERE oi.order_id = :orderId AND oi.funds_released_at IS NOT NULL
    GROUP BY oi.vendor_id, v.business_name
  `, { orderId });
  await Promise.all(vendorRows.map((vendor) => createVendorNotificationIfMissing({
    vendorId: vendor.vendorId,
    notificationType: `credits_released:${orderId}:${vendor.vendorId}`,
    title: 'Credits released',
    message: `Customer receipt was confirmed for order ${orderId}. ${Number(vendor.releasedTotal || 0)} credits moved to your available balance.`
  })));
}

async function notifyServiceCompleted(bookingId) {
  const rows = await query(`
    SELECT b.customer_user_id AS customerUserId, s.name AS serviceName
    FROM service_bookings b
    JOIN services s ON s.id = b.service_id
    WHERE b.id = :bookingId
    LIMIT 1
  `, { bookingId });
  const booking = rows[0];
  if (!booking) return;
  await createUserNotificationIfMissing({
    userId: booking.customerUserId,
    notificationType: `service_completed:${bookingId}`,
    title: 'Service marked completed',
    message: `${booking.serviceName} was marked completed. Confirm completion if everything is settled.`
  });
}

async function notifyServiceCompletionConfirmed(bookingId) {
  const rows = await query(`
    SELECT b.customer_user_id AS customerUserId, b.vendor_id AS vendorId, b.total_jmd AS total, s.name AS serviceName
    FROM service_bookings b
    JOIN services s ON s.id = b.service_id
    WHERE b.id = :bookingId
    LIMIT 1
  `, { bookingId });
  const booking = rows[0];
  if (!booking) return;
  await createUserNotificationIfMissing({
    userId: booking.customerUserId,
    notificationType: `service_completion_confirmed:${bookingId}`,
    title: 'Service completion confirmed',
    message: `${booking.serviceName} completion was confirmed and held vendor credits were released.`
  });
  await createVendorNotificationIfMissing({
    vendorId: booking.vendorId,
    notificationType: `service_credits_released:${bookingId}`,
    title: 'Service credits released',
    message: `${Number(booking.total || 0)} credits from ${booking.serviceName} moved to your available balance.`
  });
}

async function notifyCheckoutRequestCreated(requestId) {
  const rows = await query(`
    SELECT r.id, r.vendor_id AS vendorId, r.amount_coins AS amountCoins, v.business_name AS vendorName
    FROM vendor_checkout_requests r
    JOIN vendors v ON v.id = r.vendor_id
    WHERE r.id = :requestId
    LIMIT 1
  `, { requestId });
  const request = rows[0];
  if (!request) return;
  await notifyAdminUsers({
    notificationType: `new_checkout_request:${requestId}`,
    title: 'New vendor checkout request',
    message: `${request.vendorName} requested checkout for ${Number(request.amountCoins || 0)} credits.`
  });
}

async function notifyCheckoutRequestStatusChanged(requestId, status) {
  const rows = await query(`
    SELECT r.id, r.vendor_id AS vendorId, r.amount_coins AS amountCoins
    FROM vendor_checkout_requests r
    WHERE r.id = :requestId
    LIMIT 1
  `, { requestId });
  const request = rows[0];
  if (!request) return;
  await createVendorNotificationIfMissing({
    vendorId: request.vendorId,
    notificationType: `checkout_request_${status}:${requestId}`,
    title: 'Checkout request updated',
    message: `Your checkout request for ${Number(request.amountCoins || 0)} credits was marked ${status}.`
  });
}

async function notifyOrderDisputeCreated(orderId, vendorId = null) {
  const suffix = vendorId ? `:${vendorId}` : '';
  await notifyAdminUsers({
    notificationType: `order_dispute:${orderId}${suffix}`,
    title: 'Order issue reported',
    message: `Order ${orderId} has an open issue. Held credits should remain locked until review is complete.`
  });
  if (vendorId) {
    await createVendorNotificationIfMissing({
      vendorId,
      notificationType: `order_dispute:${orderId}:${vendorId}`,
      title: 'Order issue reported',
      message: `An issue was reported on order ${orderId}. Held credits remain locked while the site owner reviews it.`
    });
  }
}

async function notifyServiceDisputeCreated(bookingId) {
  const rows = await query(`
    SELECT b.vendor_id AS vendorId, s.name AS serviceName
    FROM service_bookings b
    JOIN services s ON s.id = b.service_id
    WHERE b.id = :bookingId
    LIMIT 1
  `, { bookingId });
  const booking = rows[0];
  await notifyAdminUsers({
    notificationType: `service_booking_dispute:${bookingId}`,
    title: 'Service issue reported',
    message: `${booking?.serviceName || 'A service booking'} has an open issue. Held credits should remain locked until review is complete.`
  });
  if (booking?.vendorId) {
    await createVendorNotificationIfMissing({
      vendorId: booking.vendorId,
      notificationType: `service_booking_dispute:${bookingId}`,
      title: 'Service issue reported',
      message: `${booking.serviceName} has an open issue. Held credits remain locked while the site owner reviews it.`
    });
  }
}

async function runComplianceAutomation() {
  const vendors = await listVendors();
  let alertsCreated = 0;
  let notificationsCreated = 0;
  let vendorsExpired = 0;

  for (const vendor of vendors) {
    const registrationAlert = registrationAutomationAlert(vendor);
    if (registrationAlert) {
      const alert = await createComplianceAlertIfMissing({ vendorId: vendor.id, ...registrationAlert });
      if (alert.created) alertsCreated += 1;

      const notification = await createVendorNotificationIfMissing({
        vendorId: vendor.id,
        notificationType: registrationAlert.alertType,
        title: registrationAlert.severity === 'critical' ? 'Registration action required' : 'Registration reminder',
        message: registrationAlert.message
      });
      if (notification.created) notificationsCreated += 1;

      if (registrationAlert.alertType === 'registration_expired' && vendor.registrationStatus !== 'expired') {
        await query("UPDATE vendors SET registration_status = 'expired' WHERE id = :vendorId", { vendorId: vendor.id });
        vendorsExpired += 1;
      }
    }

    if (vendor.subscriptionStatus === 'past_due') {
      const alert = await createComplianceAlertIfMissing({
        vendorId: vendor.id,
        severity: 'critical',
        alertType: 'subscription_past_due',
        message: 'Subscription is past due. Product publishing is paused until payment is restored.',
        dueDate: vendor.nextBillingAt || null
      });
      if (alert.created) alertsCreated += 1;

      const notification = await createVendorNotificationIfMissing({
        vendorId: vendor.id,
        notificationType: 'subscription_past_due',
        title: 'Subscription payment required',
        message: 'Your subscription is past due. Please update payment to keep publishing.'
      });
      if (notification.created) notificationsCreated += 1;
    }
  }

  return {
    ranAt: new Date().toISOString(),
    vendorsChecked: vendors.length,
    alertsCreated,
    notificationsCreated,
    vendorsExpired
  };
}

async function listNotificationsForVendorIds(vendorIds) {
  if (!vendorIds.length) return [];
  return query(`
    SELECT id, vendor_id AS vendorId, channel, notification_type AS notificationType, title, message, scheduled_for AS scheduledFor, sent_at AS sentAt, read_at AS readAt, created_at AS createdAt
    FROM notifications
    WHERE FIND_IN_SET(vendor_id, :vendorIds)
    ORDER BY created_at DESC
  `, { vendorIds: vendorIds.join(',') });
}

function daysUntilDate(value) {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

async function alertsForUser(userId, role) {
  if (role === 'vendor') {
    const vendorIds = await vendorIdsForUser(userId);
    const [notifications, vendorOrders, vendorBookings, vendors] = await Promise.all([
      listNotificationsForVendorIds(vendorIds),
      listVendorOrders(vendorIds),
      listVendorBookings(vendorIds),
      listVendors(false)
    ]);
    const vendorSet = new Set(vendorIds);
    const notificationAlerts = notifications.map((notification) => notificationToAlert(notification, 'vendor', '/vendor-dashboard'));
    const orderAlerts = vendorOrders
      .filter((order) => ['pending', 'preparing', 'ready_for_pickup', 'out_for_delivery'].includes(order.fulfillmentStatus) || order.fundStatus === 'waiting_customer' || order.hasOpenDispute)
      .map((order) => ({
        id: `vendor-order:${order.orderId}:${order.vendorId}`,
        audience: 'vendor',
        severity: order.hasOpenDispute ? 'critical' : order.fulfillmentStatus === 'pending' ? 'warning' : 'notice',
        type: order.hasOpenDispute ? 'order_dispute' : order.fundStatus === 'waiting_customer' ? 'waiting_customer_receipt' : 'new_order',
        title: order.hasOpenDispute ? 'Order issue reported' : order.fundStatus === 'waiting_customer' ? 'Waiting for customer receipt' : order.fulfillmentStatus === 'pending' ? 'New order needs attention' : 'Order in progress',
        message: order.hasOpenDispute
          ? `${order.customerName} has an open issue on order ${order.orderId}. Held credits remain locked until the issue is resolved.`
          : `${order.customerName} ordered ${order.itemCount} item(s). ${order.heldCredits} credits are held until delivery is confirmed.`,
        actionLabel: 'Manage order',
        actionUrl: '/vendor-dashboard',
        createdAt: order.createdAt
      }));
    const bookingAlerts = vendorBookings
      .filter((booking) => booking.paymentStatus === 'paid' && (['confirmed', 'in_progress'].includes(booking.status) || booking.fundStatus === 'waiting_customer' || booking.hasOpenDispute))
      .map((booking) => ({
        id: `vendor-booking:${booking.id}`,
        audience: 'vendor',
        severity: booking.hasOpenDispute ? 'critical' : booking.status === 'confirmed' ? 'warning' : 'notice',
        type: booking.hasOpenDispute ? 'service_booking_dispute' : booking.fundStatus === 'waiting_customer' ? 'waiting_customer_service_confirmation' : 'service_booking_paid',
        title: booking.hasOpenDispute ? 'Service issue reported' : booking.fundStatus === 'waiting_customer' ? 'Waiting for service confirmation' : 'Paid service booking',
        message: booking.hasOpenDispute
          ? `${booking.customerName} has an open issue on ${booking.serviceName}. Held credits remain locked until the issue is resolved.`
          : `${booking.customerName} booked ${booking.serviceName}. ${booking.heldCredits} credits are held until completion is confirmed.`,
        actionLabel: 'Manage booking',
        actionUrl: '/vendor-dashboard',
        createdAt: booking.bookedAt
      }));
    const subscriptionAlerts = vendors
      .filter((vendor) => vendorSet.has(vendor.id))
      .map((vendor) => ({ vendor, days: daysUntilDate(vendor.nextBillingAt) }))
      .filter(({ days }) => days !== null && days >= 0 && days <= 14)
      .map(({ vendor, days }) => ({
        id: `subscription:${vendor.id}`,
        audience: 'vendor',
        severity: days <= 3 ? 'warning' : 'notice',
        type: 'subscription_due',
        title: 'Subscription due soon',
        message: `${vendor.subscriptionPlan} renews in ${days} day(s). Keep enough Market Credits available or pay externally.`,
        actionLabel: 'View credits',
        actionUrl: '/vendor-dashboard',
        createdAt: vendor.nextBillingAt
      }));
    return [...orderAlerts, ...bookingAlerts, ...subscriptionAlerts, ...notificationAlerts]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  if (role === 'customer') {
    const [orders, bookings, notifications] = await Promise.all([
      listOrders(userId),
      listBookings(userId),
      listNotificationsForUserId(userId)
    ]);
    const notificationAlerts = notifications.map((notification) => notificationToAlert(notification, 'customer', '/user-dashboard'));
    const receiptAlerts = orders
      .filter((order) => order.canConfirmReceipt)
      .map((order) => ({
        id: `receipt:${order.orderId}`,
        audience: 'customer',
        severity: order.isReceiptLate ? 'critical' : 'warning',
        type: order.isReceiptLate ? 'late_confirm_receipt' : 'confirm_receipt',
        title: order.isReceiptLate ? 'Receipt confirmation overdue' : 'Confirm your delivery',
        message: order.isReceiptLate
          ? `Order ${order.orderId} has been waiting ${order.daysWaitingForReceipt} day(s) for receipt confirmation. Confirm receipt or report an issue.`
          : `Order ${order.orderId} has fulfilled items waiting for receipt confirmation. Confirming releases held vendor credits.`,
        actionLabel: 'Confirm receipt',
        actionUrl: `/orders/${order.orderId}`,
        orderId: order.orderId,
        canConfirmReceipt: true,
        createdAt: order.waitingReceiptSince || order.createdAt
      }));
    const disputeAlerts = orders
      .filter((order) => order.hasOpenDispute)
      .map((order) => ({
        id: `dispute:${order.orderId}`,
        audience: 'customer',
        severity: 'critical',
        type: 'order_issue_open',
        title: 'Order issue under review',
        message: `Order ${order.orderId} has an open issue. Held vendor credits will not be released until the issue is resolved.`,
        actionLabel: 'View order',
        actionUrl: `/orders/${order.orderId}`,
        orderId: order.orderId,
        createdAt: order.createdAt
      }));
    const heldAlerts = orders
      .filter((order) => !order.canConfirmReceipt && Number(order.heldItemCount || 0) > 0)
      .map((order) => ({
        id: `held:${order.orderId}`,
        audience: 'customer',
        severity: 'notice',
        type: 'order_in_progress',
        title: 'Order in progress',
        message: `Order ${order.orderId} is being prepared. Vendor credits stay on hold until you receive the goods.`,
        actionLabel: 'View order',
        actionUrl: '/user-dashboard',
        createdAt: order.createdAt
      }));
    const bookingAlerts = bookings
      .filter((booking) => booking.paymentStatus !== 'paid' || booking.canConfirmCompletion || booking.hasOpenDispute || ['requested', 'confirmed', 'in_progress'].includes(booking.status))
      .slice(0, 5)
      .map((booking) => ({
        id: `booking:${booking.id}`,
        audience: 'customer',
        severity: booking.hasOpenDispute || booking.canConfirmCompletion ? 'warning' : 'notice',
        type: booking.hasOpenDispute ? 'service_issue_open' : booking.canConfirmCompletion ? 'confirm_service_completion' : booking.paymentStatus !== 'paid' ? 'service_payment_pending' : 'service_booking',
        title: booking.hasOpenDispute ? 'Service issue under review' : booking.canConfirmCompletion ? 'Confirm service completion' : booking.paymentStatus !== 'paid' ? 'Service payment pending' : 'Service booking',
        message: booking.hasOpenDispute
          ? `${booking.serviceName} has an open issue. Held vendor credits will not be released until it is resolved.`
          : booking.canConfirmCompletion
            ? `${booking.serviceName} was marked completed. Confirm completion to release held vendor credits.`
            : booking.paymentStatus !== 'paid'
              ? `${booking.serviceName} is booked for ${dateOnly(booking.date)} at ${booking.time}. Confirm payment before the vendor starts.`
              : `${booking.serviceName} is ${booking.status} for ${dateOnly(booking.date)} at ${booking.time}.`,
        actionLabel: 'View dashboard',
        actionUrl: '/user-dashboard',
        bookingId: booking.id,
        canConfirmServiceCompletion: booking.canConfirmCompletion,
        createdAt: booking.bookedAt || booking.date
      }));
    return [...notificationAlerts, ...receiptAlerts, ...disputeAlerts, ...heldAlerts, ...bookingAlerts]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  const allVendors = await listVendors();
  const vendorIds = allVendors.map((vendor) => vendor.id);
  const [complianceAlerts, vendorOrders, vendorBookings, paymentSessions, checkoutRequests, wallets, walletAudit, adminNotifications] = await Promise.all([
    listComplianceAlerts(false),
    listVendorOrders(vendorIds),
    listVendorBookings(vendorIds),
    listPaymentSessions(),
    listVendorCheckoutRequests(vendorIds),
    listVendorWallets(vendorIds),
    listWalletAuditReport(vendorIds),
    listNotificationsForUserId(userId)
  ]);
  const storedAdminAlerts = adminNotifications.map((notification) => notificationToAlert(notification, 'admin', '/admin'));
  const paymentSessionAlerts = paymentSessions
    .filter((session) => ['created', 'pending'].includes(session.status))
    .slice(0, 15)
    .map((session) => ({
      id: `admin-payment-session:${session.id}`,
      audience: 'admin',
      severity: 'notice',
      type: 'new_payment_session',
      title: 'Payment session awaiting confirmation',
      message: `${session.kind || 'Payment'} session ${session.id} for ${session.orderId || session.serviceBookingId || session.vendorName || 'platform'} is ${session.status}.`,
      actionLabel: 'Open admin',
      actionUrl: '/admin',
      createdAt: session.createdAt
    }));
  const checkoutRequestAlerts = checkoutRequests
    .filter((request) => request.status === 'requested')
    .map((request) => ({
      id: `admin-checkout:${request.id}`,
      audience: 'admin',
      severity: 'warning',
      type: 'new_checkout_request',
      title: 'New checkout request',
      message: `${request.vendorName || request.vendorId} requested ${request.amountCoins} credits for payout.`,
      actionLabel: 'Open admin',
      actionUrl: '/admin',
      createdAt: request.createdAt
    }));
  const largeHeldAlerts = wallets
    .filter((wallet) => Number(wallet.heldCoins || 0) >= LARGE_HELD_BALANCE_CREDITS)
    .map((wallet) => ({
      id: `admin-large-held:${wallet.vendorId}`,
      audience: 'admin',
      severity: 'warning',
      type: 'large_held_balance',
      title: `${wallet.vendorName} has a large held balance`,
      message: `${wallet.heldCoins} credits are still held. Check fulfillment, customer confirmation, and open issues.`,
      actionLabel: 'Open admin',
      actionUrl: '/admin',
      createdAt: wallet.updatedAt || new Date().toISOString()
    }));
  const walletMismatchAlerts = walletAudit
    .filter((audit) => audit.status !== 'ok')
    .map((audit) => ({
      id: `admin-wallet-mismatch:${audit.vendorId}`,
      audience: 'admin',
      severity: 'critical',
      type: 'wallet_mismatch',
      title: `${audit.vendorName} wallet mismatch`,
      message: audit.mismatches.length ? audit.mismatches.join(', ') : 'Wallet audit needs review.',
      actionLabel: 'Open admin',
      actionUrl: '/admin',
      createdAt: new Date().toISOString()
    }));
  const waitingReceiptAlerts = vendorOrders
    .filter((order) => order.fundStatus === 'waiting_customer' || order.hasOpenDispute)
    .map((order) => ({
      id: `admin-order:${order.orderId}:${order.vendorId}`,
      audience: 'admin',
      severity: order.hasOpenDispute || order.isReceiptLate ? 'critical' : 'warning',
      type: order.hasOpenDispute ? 'order_dispute' : 'waiting_customer_receipt',
      title: order.hasOpenDispute ? `${order.vendorName} order issue` : `${order.vendorName} waiting on receipt`,
      message: order.hasOpenDispute
        ? `Order ${order.orderId} has an open issue. ${order.heldCredits} credits remain held.`
        : `Order ${order.orderId} is fulfilled but waiting for customer receipt confirmation. ${order.heldCredits} credits remain held.`,
      actionLabel: 'Open admin',
      actionUrl: '/admin',
      createdAt: order.waitingReceiptSince || order.createdAt
    }));
  const complianceMapped = complianceAlerts.map((alert) => ({
    id: `compliance:${alert.id}`,
    audience: 'admin',
    severity: alert.severity,
    type: alert.alertType,
    title: `${alert.vendorName} compliance`,
    message: alert.message,
    actionLabel: 'Open admin',
    actionUrl: '/admin',
    createdAt: alert.createdAt || alert.dueDate
  }));
  const serviceAlerts = vendorBookings
    .filter((booking) => booking.fundStatus === 'waiting_customer' || booking.hasOpenDispute)
    .map((booking) => ({
      id: `admin-booking:${booking.id}`,
      audience: 'admin',
      severity: booking.hasOpenDispute ? 'critical' : 'warning',
      type: booking.hasOpenDispute ? 'service_booking_dispute' : 'waiting_customer_service_confirmation',
      title: booking.hasOpenDispute ? `${booking.vendorName} service issue` : `${booking.vendorName} waiting on service confirmation`,
      message: booking.hasOpenDispute
        ? `${booking.serviceName} has an open issue. ${booking.heldCredits} credits remain held.`
        : `${booking.serviceName} is completed but waiting for customer confirmation. ${booking.heldCredits} credits remain held.`,
      actionLabel: 'Open admin',
      actionUrl: '/admin',
      createdAt: booking.vendorCompletedAt || booking.bookedAt
    }));
  return [...storedAdminAlerts, ...paymentSessionAlerts, ...checkoutRequestAlerts, ...largeHeldAlerts, ...walletMismatchAlerts, ...waitingReceiptAlerts, ...serviceAlerts, ...complianceMapped]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

async function updateRegistrationRequest(requestId, body, adminUserId) {
  await query(`
    UPDATE registration_assistance_requests
    SET status = :status, notes = :notes, assigned_admin_user_id = :adminUserId
    WHERE id = :requestId
  `, {
    requestId,
    status: ['requested', 'in_review', 'waiting_on_vendor', 'completed', 'cancelled'].includes(body.status) ? body.status : 'in_review',
    notes: body.notes || body.nextStep || null,
    adminUserId
  });
  return (await listRegistrationRequests()).find((request) => request.id === requestId);
}

async function createVendorDocument(body, uploadedByUserId) {
  const id = randomUUID();
  const fileUrl = await saveVendorDocumentUpload(id, body);
  if (!fileUrl) {
    const error = new Error('Upload a registration document file before submitting');
    error.statusCode = 400;
    throw error;
  }
  await query(`
    INSERT INTO vendor_documents (id, vendor_id, uploaded_by_user_id, document_type, file_url)
    VALUES (:id, :vendorId, :uploadedByUserId, :documentType, :fileUrl)
  `, {
    id,
    vendorId: body.vendorId,
    uploadedByUserId,
    documentType: body.documentType || 'Business registration document',
    fileUrl
  });
  return { id, vendorId: body.vendorId, documentType: body.documentType || 'Business registration document', fileUrl, status: 'pending' };
}

async function reviewVendorDocument(documentId, body, adminUserId) {
  const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : 'pending';
  await query(`
    UPDATE vendor_documents
    SET status = :status, reviewed_by_admin_user_id = :adminUserId, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = :documentId
  `, { documentId, status, adminUserId });
  const rows = await query(`
    SELECT id, vendor_id AS vendorId, document_type AS documentType, file_url AS fileUrl, status, reviewed_at AS reviewedAt
    FROM vendor_documents
    WHERE id = :documentId
    LIMIT 1
  `, { documentId });
  return rows[0] || null;
}

async function createCheckoutSession(body, frontendOrigin) {
  const vendor = await findVendorById(body.vendorId);
  const planRows = await query('SELECT id, code, name, monthly_price_jmd AS monthlyPrice FROM subscription_plans WHERE code = :planId OR id = :planId LIMIT 1', { planId: body.planId });
  const plan = planRows[0];
  if (!vendor || !plan) {
    const error = new Error('Checkout requires a valid vendor and plan');
    error.statusCode = 400;
    throw error;
  }
  const id = `PAY-${Date.now()}`;
  const checkout = buildSubscriptionCheckout({ sessionId: id, frontendOrigin, vendorId: vendor.id, planCode: plan.code });
  await query(`
    INSERT INTO payment_sessions (id, vendor_id, plan_id, provider, provider_session_id, status, amount_jmd, checkout_url, metadata)
    VALUES (:id, :vendorId, :planId, :provider, :providerSessionId, 'pending', :amount, :checkoutUrl, JSON_OBJECT('kind', 'vendor_subscription', 'planCode', :planCode))
  `, {
    id,
    vendorId: vendor.id,
    planId: plan.id,
    provider: checkout.provider,
    providerSessionId: checkout.providerSessionId,
    amount: Number(plan.monthlyPrice || 0),
    checkoutUrl: checkout.checkoutUrl,
    planCode: plan.code
  });
  return { id, provider: checkout.provider, providerSessionId: checkout.providerSessionId, vendorId: vendor.id, planId: plan.code, amount: Number(plan.monthlyPrice || 0), status: 'pending', checkoutUrl: checkout.checkoutUrl, createdAt: new Date().toISOString() };
}

async function listPaymentSessions() {
  const rows = await query(`
    SELECT
      ps.id,
      ps.provider,
      ps.provider_session_id AS providerSessionId,
      ps.vendor_id AS vendorId,
      v.business_name AS vendorName,
      ps.order_id AS orderId,
      ps.service_booking_id AS serviceBookingId,
      svc.name AS serviceName,
      ps.plan_id AS planId,
      plan.name AS planName,
      JSON_UNQUOTE(JSON_EXTRACT(ps.metadata, '$.kind')) AS kind,
      ps.amount_jmd AS amount,
      ps.status,
      ps.checkout_url AS checkoutUrl,
      ps.metadata,
      ps.created_at AS createdAt,
      ps.paid_at AS paidAt
    FROM payment_sessions ps
    LEFT JOIN vendors v ON v.id = ps.vendor_id
    LEFT JOIN service_bookings b ON b.id = ps.service_booking_id
    LEFT JOIN services svc ON svc.id = b.service_id
    LEFT JOIN subscription_plans plan ON plan.id = ps.plan_id
    ORDER BY ps.created_at DESC
  `);
  return rows.map(normalizePaymentSession);
}

async function findPaymentSessionById(sessionId) {
  const rows = await query(`
    SELECT
      ps.id,
      ps.provider,
      ps.provider_session_id AS providerSessionId,
      ps.vendor_id AS vendorId,
      v.business_name AS vendorName,
      ps.order_id AS orderId,
      ps.service_booking_id AS serviceBookingId,
      svc.name AS serviceName,
      ps.plan_id AS planId,
      plan.name AS planName,
      JSON_UNQUOTE(JSON_EXTRACT(ps.metadata, '$.kind')) AS kind,
      ps.amount_jmd AS amount,
      ps.status,
      ps.checkout_url AS checkoutUrl,
      ps.metadata,
      ps.created_at AS createdAt,
      ps.paid_at AS paidAt
    FROM payment_sessions ps
    LEFT JOIN vendors v ON v.id = ps.vendor_id
    LEFT JOIN service_bookings b ON b.id = ps.service_booking_id
    LEFT JOIN services svc ON svc.id = b.service_id
    LEFT JOIN subscription_plans plan ON plan.id = ps.plan_id
    WHERE ps.id = :sessionId
    LIMIT 1
  `, { sessionId });
  return normalizePaymentSession(rows[0]);
}

async function applyPaidPaymentSession(sessionId) {
  const result = await transaction(async (tx) => {
    const rows = await tx.query('SELECT * FROM payment_sessions WHERE id = :sessionId LIMIT 1 FOR UPDATE', { sessionId });
    const session = rows[0];
    if (!session) {
      const error = new Error('Payment session not found');
      error.statusCode = 404;
      throw error;
    }

    const normalizedSession = normalizePaymentSession(session);
    if (session.status === 'paid') {
      return {
        session: normalizedSession,
        orderId: session.order_id || null,
        bookingId: session.service_booking_id || null,
        vendorId: session.order_id || session.service_booking_id ? null : session.vendor_id,
        alreadyProcessed: true
      };
    }

    await tx.query("UPDATE payment_sessions SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = :sessionId", { sessionId });

    if (session.order_id) {
      await tx.query(`
        UPDATE orders
        SET status = 'paid', payment_status = 'paid'
        WHERE id = :orderId
      `, { orderId: session.order_id });

      const items = await tx.query(`
        SELECT
          id AS orderItemId,
          product_id AS productId,
          vendor_id AS vendorId,
          unit_price_jmd AS price,
          quantity AS qty
        FROM order_items
        WHERE order_id = :orderId
        FOR UPDATE
      `, { orderId: session.order_id });

      for (const item of items) {
        await creditOrderHold(tx.query, session.order_id, item, sessionId);
      }

      return {
        session: { ...normalizedSession, status: 'paid', paidAt: new Date().toISOString() },
        orderId: session.order_id
      };
    }

    if (session.service_booking_id) {
      const bookingRows = await tx.query(`
        SELECT id, vendor_id AS vendorId, total_jmd AS totalJmd, status
        FROM service_bookings
        WHERE id = :bookingId
        LIMIT 1
        FOR UPDATE
      `, { bookingId: session.service_booking_id });
      const booking = bookingRows[0];
      if (!booking) {
        const error = new Error('Payment session is connected to a missing service booking');
        error.statusCode = 404;
        throw error;
      }
      if (booking.status === 'cancelled') {
        const error = new Error('Cancelled service bookings cannot be paid');
        error.statusCode = 409;
        throw error;
      }

      await tx.query(`
        UPDATE service_bookings
        SET payment_status = 'paid', status = CASE WHEN status = 'requested' THEN 'confirmed' ELSE status END
        WHERE id = :bookingId
      `, { bookingId: session.service_booking_id });

      await creditServiceBookingHold(tx.query, {
        id: booking.id,
        vendorId: booking.vendorId,
        totalJmd: booking.totalJmd
      }, sessionId);

      return {
        session: { ...normalizedSession, status: 'paid', paidAt: new Date().toISOString() },
        bookingId: session.service_booking_id
      };
    }

    if (!session.vendor_id || !session.plan_id) {
      const error = new Error('Payment session is not connected to an order, service booking, or vendor subscription');
      error.statusCode = 400;
      throw error;
    }

    const nextPeriodEnd = new Date();
    nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);
    await tx.query(`
      UPDATE vendor_subscriptions
      SET status = 'cancelled'
      WHERE vendor_id = :vendorId AND status IN ('trial', 'active', 'past_due')
    `, { vendorId: session.vendor_id });
    await tx.query(`
      INSERT INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, last_payment_at)
      VALUES (:vendorId, :planId, 'active', CURRENT_DATE, :currentPeriodEnd, CURRENT_TIMESTAMP)
    `, {
      vendorId: session.vendor_id,
      planId: session.plan_id,
      currentPeriodEnd: nextPeriodEnd.toISOString().split('T')[0]
    });
    return {
      session: { ...normalizedSession, status: 'paid', paidAt: new Date().toISOString() },
      vendorId: session.vendor_id
    };
  });

  if (result.orderId) {
    if (!result.alreadyProcessed) {
      await safelyNotify(() => notifyOrderPaymentConfirmed(result.orderId, result.session.id));
    }
    return { ...result, order: await findOrderById(result.orderId) };
  }
  if (result.bookingId) {
    if (!result.alreadyProcessed) {
      await safelyNotify(() => notifyServicePaymentConfirmed(result.bookingId, result.session.id));
    }
    return { ...result, booking: await findBookingById(result.bookingId) };
  }
  if (result.vendorId) {
    if (!result.alreadyProcessed) {
      await safelyNotify(() => notifySubscriptionPaymentConfirmed(result.vendorId, result.session.id));
    }
    return { ...result, vendor: await findVendorById(result.vendorId) };
  }
  return result;
}

async function completeMockCheckout(sessionId, expectedKind = null) {
  const session = await findPaymentSessionById(sessionId);
  if (!session) {
    const error = new Error('Payment session not found');
    error.statusCode = 404;
    throw error;
  }
  if (session.provider !== 'mock') {
    const error = new Error('Mock checkout completion is only available for the mock payment provider');
    error.statusCode = 409;
    throw error;
  }
  if (expectedKind && session.kind !== expectedKind) {
    const error = new Error(`Payment session is not a ${expectedKind.replace(/_/g, ' ')} session`);
    error.statusCode = 409;
    throw error;
  }

  const providerEventId = `mock-paid-${sessionId}-${Date.now()}`;
  const eventType = session.kind === 'customer_order'
    ? 'order.payment.paid'
    : session.kind === 'service_booking'
      ? 'service.booking.payment.paid'
      : 'subscription.payment.paid';
  const event = await recordPaymentEvent({
    provider: 'mock',
    providerEventId,
    eventType,
    payload: { sessionId }
  });
  const result = await applyPaidPaymentSession(sessionId);
  await query('UPDATE payment_events SET processed_at = CURRENT_TIMESTAMP WHERE provider_event_id = :providerEventId', { providerEventId });
  return { processed: true, eventId: event?.id, ...result };
}

async function markPaymentSessionPaid(sessionId) {
  const session = await findPaymentSessionById(sessionId);
  if (!session) {
    const error = new Error('Payment session not found');
    error.statusCode = 404;
    throw error;
  }
  if (session.provider !== 'mock') {
    const error = new Error('Non-mock payment sessions can only be marked paid by a verified payment webhook');
    error.statusCode = 409;
    error.sessionId = sessionId;
    throw error;
  }
  return completeMockCheckout(sessionId);
}

async function recordPaymentEvent({ provider, providerEventId, eventType, payload }) {
  const id = randomUUID();
  try {
    await query(`
      INSERT INTO payment_events (id, provider, provider_event_id, event_type, payload)
      VALUES (:id, :provider, :providerEventId, :eventType, :payload)
    `, {
      id,
      provider,
      providerEventId,
      eventType,
      payload: JSON.stringify(payload)
    });
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
  }

  const rows = await query('SELECT * FROM payment_events WHERE provider_event_id = :providerEventId LIMIT 1', { providerEventId });
  return rows[0] || null;
}

async function processPaymentWebhook({ provider, providerEventId, eventType, payload }) {
  const event = await recordPaymentEvent({ provider, providerEventId, eventType, payload });
  if (event?.processed_at) {
    return { processed: false, duplicate: true, eventId: event.id };
  }

  if (!['payment.session.paid', 'subscription.payment.paid', 'order.payment.paid', 'service.booking.payment.paid'].includes(eventType)) {
    await query('UPDATE payment_events SET processed_at = CURRENT_TIMESTAMP WHERE provider_event_id = :providerEventId', { providerEventId });
    return { processed: true, ignored: true, eventId: event?.id };
  }

  const sessionId = payload.sessionId || payload.paymentSessionId || payload.data?.sessionId;
  if (!sessionId) {
    const error = new Error('Webhook payload missing sessionId');
    error.statusCode = 400;
    throw error;
  }

  const result = await applyPaidPaymentSession(sessionId);
  await query('UPDATE payment_events SET processed_at = CURRENT_TIMESTAMP WHERE provider_event_id = :providerEventId', { providerEventId });
  return { processed: true, eventId: event?.id, ...result };
}

async function listPaymentEvents() {
  return query(`
    SELECT id, provider, provider_event_id AS providerEventId, event_type AS eventType, processed_at AS processedAt, created_at AS createdAt
    FROM payment_events
    ORDER BY created_at DESC
  `);
}

async function adminFinanceSummary() {
  const [paymentRows, walletRows, payoutRows] = await Promise.all([
    query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' AND (order_id IS NOT NULL OR service_booking_id IS NOT NULL) THEN amount_jmd ELSE 0 END), 0) AS totalCustomerPaymentsJmd,
        COALESCE(SUM(CASE WHEN status = 'paid' AND plan_id IS NOT NULL THEN amount_jmd ELSE 0 END), 0) AS totalSubscriptionPaymentsJmd,
        COUNT(CASE WHEN order_id IS NOT NULL THEN 1 ELSE NULL END) AS orderPaymentSessionCount,
        COUNT(CASE WHEN order_id IS NOT NULL AND status = 'paid' THEN 1 ELSE NULL END) AS paidOrderPaymentSessionCount
      FROM payment_sessions
    `),
    query(`
      SELECT
        COALESCE(SUM(held_coins), 0) AS totalHeldCredits,
        COALESCE(SUM(available_coins), 0) AS totalAvailableCredits,
        COALESCE(SUM(pending_checkout_coins), 0) AS totalPendingCheckoutCredits,
        COALESCE(SUM(lifetime_earned_coins), 0) AS totalLifetimeEarnedCredits
      FROM vendor_wallet_accounts
    `),
    query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_coins ELSE 0 END), 0) AS totalVendorPayoutsPaidCredits,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_jmd ELSE 0 END), 0) AS totalVendorPayoutsPaidJmd,
        COALESCE(SUM(CASE WHEN status IN ('requested', 'approved') THEN amount_coins ELSE 0 END), 0) AS totalVendorPayoutsPendingCredits,
        COUNT(CASE WHEN status IN ('requested', 'approved') THEN 1 ELSE NULL END) AS openCheckoutRequestCount
      FROM vendor_checkout_requests
    `)
  ]);

  const payments = paymentRows[0] || {};
  const wallets = walletRows[0] || {};
  const payouts = payoutRows[0] || {};
  return {
    totalCustomerPaymentsJmd: Number(payments.totalCustomerPaymentsJmd || 0),
    totalSubscriptionPaymentsJmd: Number(payments.totalSubscriptionPaymentsJmd || 0),
    orderPaymentSessionCount: Number(payments.orderPaymentSessionCount || 0),
    paidOrderPaymentSessionCount: Number(payments.paidOrderPaymentSessionCount || 0),
    totalHeldCredits: Number(wallets.totalHeldCredits || 0),
    totalAvailableCredits: Number(wallets.totalAvailableCredits || 0),
    totalPendingCheckoutCredits: Number(wallets.totalPendingCheckoutCredits || 0),
    totalLifetimeEarnedCredits: Number(wallets.totalLifetimeEarnedCredits || 0),
    totalVendorPayoutsPaidCredits: Number(payouts.totalVendorPayoutsPaidCredits || 0),
    totalVendorPayoutsPaidJmd: Number(payouts.totalVendorPayoutsPaidJmd || 0),
    totalVendorPayoutsPendingCredits: Number(payouts.totalVendorPayoutsPendingCredits || 0),
    openCheckoutRequestCount: Number(payouts.openCheckoutRequestCount || 0)
  };
}

async function listAdminAuditLogs(filters = {}) {
  const action = filters.action && filters.action !== 'all' ? filters.action : null;
  const entityType = filters.entityType && filters.entityType !== 'all' ? filters.entityType : null;
  const entityId = filters.entityId && filters.entityId !== 'all' ? filters.entityId : null;
  const rows = await query(`
    SELECT
      log.id,
      log.admin_user_id AS adminUserId,
      admin.full_name AS adminName,
      COALESCE(admin.email, admin.phone) AS adminLogin,
      log.action,
      log.entity_type AS entityType,
      log.entity_id AS entityId,
      log.details,
      log.created_at AS createdAt
    FROM admin_audit_logs log
    LEFT JOIN users admin ON admin.id = log.admin_user_id
    WHERE (:action IS NULL OR log.action = :action)
      AND (:entityType IS NULL OR log.entity_type = :entityType)
      AND (:entityId IS NULL OR log.entity_id = :entityId)
    ORDER BY log.created_at DESC
    LIMIT 250
  `, { action, entityType, entityId });
  return rows.map((row) => ({
    ...row,
    adminName: row.adminName || 'System',
    details: typeof row.details === 'string' ? safeParseJson(row.details, {}) : row.details
  }));
}

async function recordAdminAudit({ adminUserId, action, entityType, entityId, details = {} }) {
  await recordAuditEntry(query, { adminUserId, action, entityType, entityId, details });
}

async function adminSummary() {
  const [userRows, vendorRows, serviceRows, bookingRows, applicationRows, pendingJobRows, paymentSessionRows, registrationRows] = await Promise.all([
    query('SELECT COUNT(*) AS total FROM users'),
    query('SELECT COUNT(*) AS total FROM vendors'),
    query('SELECT COUNT(*) AS total FROM services'),
    query('SELECT COUNT(*) AS total FROM service_bookings'),
    query('SELECT COUNT(*) AS total FROM job_applications'),
    query("SELECT COUNT(*) AS total FROM jobs WHERE status = 'pending_approval'"),
    query('SELECT COUNT(*) AS total FROM payment_sessions'),
    query('SELECT COUNT(*) AS total FROM registration_assistance_requests')
  ]);

  const vendors = await listVendors();
  const dbComplianceAlerts = await listComplianceAlerts();

  return {
    users: Number(userRows[0].total),
    vendors: Number(vendorRows[0].total),
    services: Number(serviceRows[0].total),
    bookings: Number(bookingRows[0].total),
    applications: Number(applicationRows[0].total),
    pendingJobs: Number(pendingJobRows[0].total),
    complianceAlerts: dbComplianceAlerts.length ? dbComplianceAlerts : vendors.map(complianceAlertFor),
    paymentSessions: Number(paymentSessionRows[0].total),
    registrationAssistanceRequests: Number(registrationRows[0].total),
    finance: await adminFinanceSummary()
  };
}

module.exports = {
  adminSummary,
  addCartItem,
  alertsForUser,
  cartForUser,
  clearCart,
  confirmOrderReceived,
  confirmServiceBookingCompleted,
  createApplication,
  createBooking,
  createCheckoutSession,
  completeMockCheckout,
  createCustomerAddress,
  createDiscount,
  createJob,
  createOrder,
  createOrderDispute,
  createProduct,
  createProductImage,
  createRegistrationRequest,
  createService,
  createServiceImage,
  createServiceBookingDispute,
  createStoreMedia,
  upsertStoreSocialLink,
  createUser,
  createVendorDocument,
  createVendorCheckoutRequest,
  createReview,
  customizationMediaDownload,
  customerDashboard,
  defaultVendorIdForUser,
  deleteCustomizationField,
  deleteCustomizationFieldOption,
  deleteCustomizationPlacement,
  deleteCustomizationSurface,
  deleteDiscount,
  deleteStoreSocialLink,
  findJobById,
  findOrderById,
  findBookingById,
  findVendorDocumentById,
  findPublicJobById,
  findPaymentSessionById,
  findPublicProductById,
  findServiceById,
  findUserById,
  findVendorBySlug,
  findPublicVendorBySlug,
  findUserByEmailPhone,
  isDatabaseEnabled,
  adminFinanceSummary,
  customizationTemplateByProductId,
  customizationTemplateById,
  listApplications,
  listApplicationsForUser,
  listAdminAuditLogs,
  listBookings,
  listComplianceAlerts,
  listCustomerAddresses,
  listCustomerReviewTargets,
  listCustomizationTemplates,
  listCustomizationUploads,
  listFoods,
  listJobs,
  listingMediaDownload,
  listNotificationsForVendorIds,
  listOrders,
  listVendorOrders,
  listVendorBookings,
  listPaymentSessions,
  listPaymentEvents,
  listProducts,
  listRegistrationRequests,
  listServices,
  listSubscriptionPlans,
  listUsers,
  listVendors,
  listVendorDocuments,
  listVendorDiscounts,
  listVendorJobs,
  listVendorCheckoutRequests,
  listVendorPayoutProfiles,
  listWalletAuditReport,
  listVendorWalletLedger,
  listVendorWallets,
  listVendorProducts,
  listVendorServices,
  markPaymentSessionPaid,
  paySubscriptionWithWallet,
  profileForUser,
  promoteUserToAdmin,
  recordAdminAudit,
  processPaymentWebhook,
  removeCartItem,
  reviewVendorDocument,
  repairWalletAudit,
  runComplianceAutomation,
  saveCustomizationField,
  saveCustomizationFieldOption,
  saveCustomizationPlacement,
  saveCustomizationSurface,
  storeByVendorId,
  updateCustomizationField,
  updateCustomizationFieldOption,
  updateCustomizationPlacement,
  updateCustomizationSurface,
  updateCustomizationSurfaceImage,
  updateCustomizationTemplateStatus,
  upsertProductCustomizationTemplate,
  updateJob,
  updateCartItem,
  updateDiscountStatus,
  updateOrderFulfillment,
  updateOrderStatus,
  updateServiceBookingStatus,
  updateProduct,
  updateProductStock,
  updateUserProfile,
  updateUserStatus,
  updateVendorSubscription,
  upsertVendorPayoutProfile,
  updateVendorCheckoutRequestStatus,
  updateVendorStatus,
  updateRegistrationRequest,
  updateService,
  updateStore,
  applyDiscountToProduct,
  offerDiscountToCart,
  featureProductWithWallet,
  removeDiscountFromProduct,
  vendorOperationsForUser,
  vendorIdForDocument,
  vendorIdForDiscount,
  vendorIdForBooking,
  vendorIdForCustomizationField,
  vendorIdForCustomizationOption,
  vendorIdForCustomizationPlacement,
  vendorIdForCustomizationSurface,
  vendorIdForCustomizationTemplate,
  vendorIdForJob,
  vendorIdForProduct,
  vendorIdForService,
  vendorIdForStore,
  vendorDocumentDownload,
  vendorIdsForUser,
  validateProductCustomization
};
