const config = require('../config');
const { buildOrderCheckout, buildServiceCheckout, buildSubscriptionCheckout } = require('../payments');
const { query, transaction } = require('../db/mysql');
const { randomUUID } = require('crypto');
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

function complianceAlertFor(vendor) {
  const isRegistered = vendor.registrationStatus === 'registered';
  const daysRemaining = isRegistered ? null : daysUntilExpiry(vendor);
  const canPublishProducts = vendor.subscriptionStatus === 'active' && isRegistered;
  let severity = 'ok';
  let message = 'Vendor is compliant.';

  if (vendor.subscriptionStatus === 'past_due') {
    severity = 'critical';
    message = 'Subscription is past due. Product publishing is paused until payment is restored.';
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
    eligibility: isRegistered
      ? { canSell: true, reason: 'registered_business' }
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
    && vendor.registrationStatus === 'registered';
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
  return `uploads/resumes/${fileName}`;
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
  return `uploads/vendor-documents/${fileName}`;
}

async function saveListingImageUpload(imageId, body) {
  if (!body.imageDataBase64) {
    return body.url || body.imageUrl || null;
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
  return `uploads/listing-media/${fileName}`;
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
      p.type AS category,
      p.price_jmd AS price,
      p.stock_quantity AS stockQuantity,
      p.delivery_day AS deliveryDay,
      p.description,
      product_image.imageUrl,
      feature.featuredUntil
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    LEFT JOIN stores st ON st.id = p.store_id
    ${primaryProductImageJoin()}
    LEFT JOIN (
      SELECT product_id AS productId, MAX(ends_at) AS featuredUntil
      FROM product_features
      WHERE status = 'active' AND ends_at > NOW()
      GROUP BY product_id
    ) feature ON feature.productId = p.id
    WHERE p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
      AND (st.id IS NULL OR st.status = 'active')
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
      featuredUntil: row.featuredUntil || null,
      isFeatured: Boolean(row.featuredUntil),
      rating: 4.8
    };
  }));
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
    LEFT JOIN stores st ON st.id = s.store_id
    ${primaryServiceImageJoin()}
    WHERE s.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
      AND (st.id IS NULL OR st.status = 'active')
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
    SELECT p.id, p.name, p.vendor_id AS vendorId, p.store_id AS storeId, p.price_jmd AS price, p.description, product_image.imageUrl
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    LEFT JOIN stores st ON st.id = p.store_id
    ${primaryProductImageJoin()}
    WHERE p.type = 'food'
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
      AND (st.id IS NULL OR st.status = 'active')
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
      discount: normalizeDiscount(discount)
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

  if (!vendor || !plan) {
    const error = new Error('Vendor subscription update requires a valid vendor and plan');
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

async function cartItemsForCart(cartId) {
  const rows = await query(`
    SELECT
      ci.cart_id AS cartId,
      c.customer_user_id AS customerUserId,
      ci.product_id AS productId,
      p.name,
      ci.vendor_id AS vendorId,
      v.business_name AS vendorName,
      ci.store_id AS storeId,
      ci.unit_price_jmd AS price,
      p.stock_quantity AS stockQuantity,
      p.delivery_day AS deliveryDay,
      ci.quantity AS qty
    FROM cart_items ci
    JOIN carts c ON c.id = ci.cart_id
    JOIN products p ON p.id = ci.product_id
    JOIN vendors v ON v.id = ci.vendor_id
    ${publicVendorSubscriptionJoin()}
    LEFT JOIN stores st ON st.id = ci.store_id
    WHERE ci.cart_id = :cartId
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
      AND (st.id IS NULL OR st.status = 'active')
    ORDER BY ci.created_at
  `, { cartId });

  return Promise.all(rows.map(async (item) => {
    const originalPrice = Number(item.price || 0);
    const discount = await bestDiscountForProduct({
      id: item.productId,
      vendorId: item.vendorId,
      storeId: item.storeId
    }, item.customerUserId, originalPrice, query, item.cartId);
    return {
      ...item,
      originalPrice,
      price: discountedUnitPrice(originalPrice, discount),
      discount: normalizeDiscount(discount),
      qty: Number(item.qty || 0),
      stockQuantity: Number(item.stockQuantity || 0)
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

async function addCartItem(customerUserId, { productId, qty = 1 }) {
  const cart = await activeCartForUser(customerUserId);
  const rows = await query(`
    SELECT p.id, p.vendor_id AS vendorId, p.store_id AS storeId, p.price_jmd AS price, p.stock_quantity AS stockQuantity
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    LEFT JOIN stores st ON st.id = p.store_id
    WHERE p.id = :productId
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
      AND (st.id IS NULL OR st.status = 'active')
    LIMIT 1
  `, { productId });
  const product = rows[0];
  if (!product) {
    const error = new Error('Product is not available for cart');
    error.statusCode = 404;
    throw error;
  }
  const requestedQty = Math.max(1, Math.floor(Number(qty) || 1));
  const currentRows = await query(`
    SELECT quantity
    FROM cart_items
    WHERE cart_id = :cartId AND product_id = :productId
    LIMIT 1
  `, { cartId: cart.id, productId });
  const currentQty = Number(currentRows[0]?.quantity || 0);
  if (Number(product.stockQuantity || 0) < currentQty + requestedQty) {
    const error = new Error('Not enough stock is available for this product');
    error.statusCode = 409;
    throw error;
  }
  await query(`
    INSERT INTO cart_items (cart_id, product_id, vendor_id, store_id, quantity, unit_price_jmd)
    VALUES (:cartId, :productId, :vendorId, :storeId, :qty, :price)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), unit_price_jmd = VALUES(unit_price_jmd)
  `, {
    cartId: cart.id,
    productId,
    vendorId: product.vendorId,
    storeId: product.storeId,
    qty: requestedQty,
    price: Number(product.price || 0)
  });
  return cartForUser(customerUserId);
}

async function updateCartItem(customerUserId, productId, qty) {
  const cart = await activeCartForUser(customerUserId);
  const quantity = Math.max(1, Math.floor(Number(qty) || 1));
  const rows = await query(`
    SELECT p.stock_quantity AS stockQuantity
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    ${publicVendorSubscriptionJoin()}
    LEFT JOIN stores st ON st.id = p.store_id
    WHERE p.id = :productId
      AND p.status = 'published'
      AND v.status = 'active'
      AND v.registration_status = 'registered'
      AND (st.id IS NULL OR st.status = 'active')
    LIMIT 1
  `, { productId });
  if (!rows[0]) {
    const error = new Error('Product is not available for cart');
    error.statusCode = 404;
    throw error;
  }
  if (Number(rows[0].stockQuantity || 0) < quantity) {
    const error = new Error('Not enough stock is available for this product');
    error.statusCode = 409;
    throw error;
  }
  await query(`
    UPDATE cart_items
    SET quantity = :quantity
    WHERE cart_id = :cartId AND product_id = :productId
  `, { cartId: cart.id, productId, quantity });
  return cartForUser(customerUserId);
}

async function removeCartItem(customerUserId, productId) {
  const cart = await activeCartForUser(customerUserId);
  await query('DELETE FROM cart_items WHERE cart_id = :cartId AND product_id = :productId', { cartId: cart.id, productId });
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
          LEFT JOIN stores st ON st.id = p.store_id
          WHERE p.id = :id
            AND p.status = 'published'
            AND v.status = 'active'
            AND v.registration_status = 'registered'
            AND (st.id IS NULL OR st.status = 'active')
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
            AND st.status = 'active'
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
      const preparedItem = {
        orderItemId: randomUUID(),
        productId: product?.id || null,
        vendorId,
        storeId,
        name: item.name || product?.name || 'Item',
        originalPrice,
        price: unitPrice,
        qty,
        discount: normalizeDiscount(discount)
      };
      preparedItems.push(preparedItem);
      subtotal += unitPrice * qty;
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
      oi.fulfillment_status AS fulfillmentStatus,
      oi.vendor_completed_at AS vendorCompletedAt,
      oi.customer_received_at AS customerReceivedAt,
      oi.funds_released_at AS fundsReleasedAt
    FROM order_items oi
    JOIN vendors v ON v.id = oi.vendor_id
    JOIN stores s ON s.id = oi.store_id
    WHERE oi.order_id = :orderId
  `, { orderId });
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
    items
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
    hasOpenDispute: Number(order.openDisputeCount || 0) > 0
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

async function updateOrderFulfillment(orderId, vendorId, fulfillmentStatus) {
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
    WHERE order_id = :orderId AND vendor_id = :vendorId
    `, { orderId, vendorId, status });
  if (result.affectedRows < 1) {
    const error = new Error('Order item not found for this vendor');
    error.statusCode = 404;
    throw error;
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
    SELECT id, vendor_id AS vendorId, name
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
  const filePath = path.resolve(VENDOR_DOCUMENT_UPLOAD_DIR, fileName);
  const uploadRoot = path.resolve(VENDOR_DOCUMENT_UPLOAD_DIR);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
    return null;
  }

  return {
    ...document,
    fileName,
    filePath,
    contentType: contentTypeForDocument(fileName)
  };
}

function listingMediaDownload(fileName) {
  const safeName = path.basename(String(fileName || ''));
  if (!safeName) return null;
  const filePath = path.resolve(LISTING_MEDIA_UPLOAD_DIR, safeName);
  const uploadRoot = path.resolve(LISTING_MEDIA_UPLOAD_DIR);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
    return null;
  }
  return {
    fileName: safeName,
    filePath,
    contentType: contentTypeForListingImage(safeName)
  };
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
      discounts.discountIds,
      discounts.discountNames,
      feature.featuredUntil
    FROM products p
    ${primaryProductImageJoin()}
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
      featuredUntil: row.featuredUntil || null,
      isFeatured: Boolean(row.featuredUntil)
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
    SELECT id, vendor_id AS vendorId, title, employer_name AS employer, category, location, salary_jmd AS salary, job_type AS type, description, responsibilities, requirements, contact, status, deadline, created_at AS createdAt
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

async function vendorOperationsForUser(userId, includeAll = false) {
  const vendorIds = includeAll ? (await listVendors()).map((vendor) => vendor.id) : await vendorIdsForUser(userId);
  const vendors = (await listVendors()).filter((vendor) => vendorIds.includes(vendor.id));
  const stores = (await Promise.all(vendorIds.map(storeByVendorId))).filter(Boolean);
  const storeIds = stores.map((store) => store.id);
  const [products, services, jobs, documents, media, registrationRequests, notifications, cartCustomers, discounts, orders, bookings, wallets, walletLedger, checkoutRequests, payoutProfiles, walletAudit] = await Promise.all([
    listVendorProducts(vendorIds),
    listVendorServices(vendorIds),
    listVendorJobs(vendorIds),
    listVendorDocuments(vendorIds),
    listStoreMedia(storeIds),
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

  return { vendors, stores, products, services, jobs, documents, media, registrationRequests, notifications, cartCustomers, discounts, orders, bookings, wallets, walletLedger, checkoutRequests, payoutProfiles, walletAudit };
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
  if (status === 'published') assertPublishAllowed(vendor, 'publish products');

  const id = `p${Date.now()}`;
  const storeId = body.storeId || await defaultStoreIdForVendor(vendor.id);
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
  if (status === 'published') assertPublishAllowed(vendor, 'publish products');
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
    type: body.type === 'food' ? 'food' : product.type,
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
  await query(`
    INSERT INTO product_images (id, product_id, url, alt_text, sort_order)
    VALUES (:id, :productId, :url, :altText, :sortOrder)
  `, {
    id,
    productId,
    url,
    altText: body.altText || null,
    sortOrder: Number(body.sortOrder) || 0
  });
  return { id, productId, url, altText: body.altText || '', sortOrder: Number(body.sortOrder) || 0 };
}

async function createStoreMedia(storeId, body) {
  const id = randomUUID();
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
    mediaType: ['logo', 'banner', 'gallery'].includes(body.mediaType) ? body.mediaType : 'gallery',
    url,
    altText: body.altText || null,
    sortOrder: Number(body.sortOrder) || 0
  });
  return { id, storeId, mediaType: body.mediaType || 'gallery', url, altText: body.altText || '', sortOrder: Number(body.sortOrder) || 0 };
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
  if (status === 'published') assertPublishAllowed(vendor, 'publish services');
  const id = `svc-${Date.now()}`;
  const storeId = body.storeId || await defaultStoreIdForVendor(vendor.id);
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
  if (status === 'published') assertPublishAllowed(vendor, 'publish services');
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
    INSERT INTO jobs (id, vendor_id, posted_by_user_id, title, employer_name, category, location, salary_jmd, job_type, description, responsibilities, requirements, contact, status, deadline)
    VALUES (:id, :vendorId, :postedByUserId, :title, :employer, :category, :location, :salary, :type, :description, :responsibilities, :requirements, :contact, :status, :deadline)
  `, {
    id,
    vendorId: body.vendorId || await defaultVendorIdForUser(user.id),
    postedByUserId: user.id,
    title: body.title,
    employer: body.employer,
    category: body.category || 'Other',
    location: body.location,
    salary: Number(body.salary) || 0,
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
    SET title = :title, employer_name = :employer, category = :category, location = :location, salary_jmd = :salary, job_type = :type, description = :description, responsibilities = :responsibilities, requirements = :requirements, contact = :contact, status = :status, deadline = :deadline
    WHERE id = :jobId
  `, {
    jobId,
    title: body.title ?? job.title,
    employer: body.employer ?? job.employer_name,
    category: body.category ?? job.category,
    location: body.location ?? job.location,
    salary: Number(body.salary ?? job.salary_jmd) || 0,
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
  createUser,
  createVendorDocument,
  createVendorCheckoutRequest,
  createReview,
  customerDashboard,
  defaultVendorIdForUser,
  deleteDiscount,
  findJobById,
  findOrderById,
  findBookingById,
  findVendorDocumentById,
  findPublicJobById,
  findPaymentSessionById,
  findServiceById,
  findUserById,
  findVendorBySlug,
  findPublicVendorBySlug,
  findUserByEmailPhone,
  isDatabaseEnabled,
  adminFinanceSummary,
  listApplications,
  listApplicationsForUser,
  listAdminAuditLogs,
  listBookings,
  listComplianceAlerts,
  listCustomerAddresses,
  listCustomerReviewTargets,
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
  storeByVendorId,
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
  vendorIdForJob,
  vendorIdForProduct,
  vendorIdForService,
  vendorIdForStore,
  vendorDocumentDownload,
  vendorIdsForUser
};
