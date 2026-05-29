const http = require('http');
const fs = require('fs/promises');
const config = require('./config');
const { getAuthUser, hashPassword, requireRoles, safeUser, signToken, verifyPassword } = require('./auth');
const { databaseMode } = require('./db/mysql');
const logger = require('./logger');
const { parseWebhook, providerName, verifyWebhookSignature } = require('./payments');
const { createRateLimiter } = require('./rateLimiter');
const repository = require('./repositories/platform.repository');
const {
  validateAddress,
  validateAuthLogin,
  validateCartItem,
  validateProduct,
  validateReview,
  validateService,
  validateSubscriptionCheckout,
  validateSignup
} = require('./validation');

const port = config.port;
const frontendOrigin = config.frontendOrigin;
const rateLimit = createRateLimiter({
  windowMs: config.rateLimitWindowMs,
  maxRequests: config.rateLimitMaxRequests
});

const vendors = [
  {
    id: 'v1',
    name: 'Island Eats',
    slug: 'island-eats',
    location: 'Half Way Tree',
    addressLine1: 'Half Way Tree',
    parish: 'St. Andrew',
    latitude: 18.0125,
    longitude: -76.7981,
    rating: 4.8,
    deliveryDays: ['Mon', 'Wed', 'Fri'],
    registrationStatus: 'unregistered',
    onboardedAt: '2026-02-01',
    subscriptionStatus: 'trial',
    subscriptionPlan: 'Starter vendor',
    lastPaymentAt: null,
    nextBillingAt: '2026-05-01'
  },
  {
    id: 'v2',
    name: 'Market Glow',
    slug: 'market-glow',
    location: 'Portmore',
    addressLine1: 'Portmore',
    parish: 'St. Catherine',
    latitude: 17.9503,
    longitude: -76.8827,
    rating: 4.7,
    deliveryDays: ['Wed', 'Fri'],
    registrationStatus: 'registered',
    onboardedAt: '2025-06-15',
    subscriptionStatus: 'active',
    subscriptionPlan: 'Growth vendor',
    lastPaymentAt: '2026-04-15',
    nextBillingAt: '2026-05-15'
  },
  {
    id: 'v3',
    name: 'Green Grove',
    slug: 'green-grove',
    location: 'Spanish Town',
    addressLine1: 'Spanish Town',
    parish: 'St. Catherine',
    latitude: 17.9911,
    longitude: -76.9574,
    rating: 4.9,
    deliveryDays: ['Tue', 'Fri'],
    registrationStatus: 'registered',
    onboardedAt: '2025-09-05',
    subscriptionStatus: 'active',
    subscriptionPlan: 'Growth vendor',
    lastPaymentAt: '2026-04-05',
    nextBillingAt: '2026-05-05'
  }
];

const subscriptionPlans = [
  { id: 'starter', name: 'Starter vendor', monthlyPrice: 2500, productLimit: 25 },
  { id: 'growth', name: 'Growth vendor', monthlyPrice: 6500, productLimit: 150 },
  { id: 'pro', name: 'Pro vendor', monthlyPrice: 12500, productLimit: 500 }
];

const products = [
  { id: 'p1', name: 'Organic Callaloo Bundle', vendorId: 'v3', price: 2350, deliveryDay: 'Fri' },
  { id: 'p2', name: 'Jerk Chicken Family Pack', vendorId: 'v1', price: 4250, deliveryDay: 'Mon' },
  { id: 'p3', name: 'Glow Essentials Kit', vendorId: 'v2', price: 3900, deliveryDay: 'Wed' }
];

const services = [
  { id: 'delivery-run', name: 'Same-Day Delivery Run', vendor: 'Urban Couriers', category: 'Delivery Services', rating: 4.9, price: 1100, pricingType: 'Fixed', description: 'Send packages, groceries, or urgent items across the city with fast local delivery.' },
  { id: 'home-repairs', name: 'Home Repairs & Maintenance', vendor: 'Fix-It Crew', category: 'Home Services', rating: 4.8, price: 2800, pricingType: 'Hourly', description: 'Local technicians for plumbing, electrical, carpentry and small home repairs.' },
  { id: 'personal-care', name: 'Personal Care & Grooming', vendor: 'Glow Mobile Salon', category: 'Personal Services', rating: 4.7, price: 2000, pricingType: 'Fixed', description: 'Mobile beauty and grooming services for haircuts, manicures, and styling.' },
  { id: 'errand-run', name: 'Errands & Pickup Service', vendor: 'Errand Express', category: 'Errands / Pickup Services', rating: 4.6, price: 950, pricingType: 'Fixed', description: 'Run errands, pick up groceries, or collect parcels from local stores and vendors.' }
];

const foods = [
  { id: 'f1', name: 'Spicy Jerk Chicken', vendorId: 'v1', price: 2750, description: 'Hot jerk chicken meal for families and events.' },
  { id: 'f2', name: 'Patties & Sides', vendorId: 'v1', price: 1620, description: 'Assorted patty platter with drinks and snacks.' },
  { id: 'f3', name: 'Fresh Fruit Crate', vendorId: 'v3', price: 2100, description: 'Seasonal fruits sourced from local growers.' },
  { id: 'f4', name: 'Island Breakfast Box', vendorId: 'v1', price: 1980, description: 'Breakfast items with coffee, buns, and fresh juice.' }
];

const jobs = [
  { id: 'jm001', vendorId: null, title: 'Marketplace Delivery Coordinator', employer: 'Island Logistics', category: 'Delivery', location: 'Kingston', salary: 2400, type: 'Full-time', postedAt: '2026-04-10', deadline: '2026-05-05', description: 'Coordinate delivery teams, manage routes, and ensure on-time pickup for marketplace orders.', responsibilities: ['Plan delivery routes', 'Communicate with vendors and drivers', 'Track performance and delivery time'], requirements: ['Excellent communication skills', 'Experience with local logistics', 'Ability to work with scheduling tools'], contact: 'jobs@islandlogistics.jm', isApproved: true, status: 'Published' },
  { id: 'jm002', vendorId: 'v2', title: 'Freelance Website Builder', employer: 'Market Glow', category: 'Digital Services', location: 'Remote', salary: 1800, type: 'Contract', postedAt: '2026-04-12', deadline: '2026-05-01', description: 'Build landing pages and e-commerce storefronts for local vendors using simple responsive design.', responsibilities: ['Develop websites', 'Collect vendor assets', 'Deploy finished pages'], requirements: ['Web development experience', 'Responsive design skills', 'Basic SEO knowledge'], contact: 'talent@marketglow.jm', isApproved: true, status: 'Published' },
  { id: 'jm003', vendorId: 'v1', title: 'Event Catering Assistant', employer: 'Island Eats', category: 'Hospitality', location: 'Portmore', salary: 1200, type: 'Part-time', postedAt: '2026-04-14', deadline: '2026-04-28', description: 'Support catering events with food prep, delivery setup, and customer service during meals.', responsibilities: ['Prepare food packages', 'Assist at event sites', 'Communicate with customers and vendors'], requirements: ['Friendly customer service', 'Weekend availability', 'Food handling experience preferred'], contact: 'careers@islandeats.jm', isApproved: true, status: 'Published' }
];

const orders = [];
const bookings = [];
const applications = [];
const paymentSessions = [];
const registrationAssistanceRequests = [];
const users = [
  { id: 'admin-1', name: 'Platform Owner', emailPhone: 'owner@urbanmarket.jm', role: 'admin' },
  { id: 'vendor-1', name: 'Island Eats Manager', emailPhone: 'vendor@urbanmarket.jm', role: 'vendor', businessName: 'Island Eats', businessLocation: 'Half Way Tree' },
  { id: 'customer-1', name: 'Urban Member', emailPhone: 'member@example.com', role: 'customer' }
];
let currentUser = null;

function unregisteredExpiry(vendor) {
  const expiry = new Date(vendor.onboardedAt);
  expiry.setFullYear(expiry.getFullYear() + 1);
  return expiry;
}

function vendorEligibility(vendor) {
  if (vendor.registrationStatus === 'registered') {
    return { canSell: true, reason: 'registered_business' };
  }

  const expiry = unregisteredExpiry(vendor);
  const daysRemaining = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
  return {
    canSell: false,
    reason: 'registration_required_for_public_listing',
    registrationAssistanceOffered: true,
    expiresAt: expiry.toISOString(),
    daysRemaining
  };
}

function complianceSeverity(vendor) {
  if (vendor.subscriptionStatus === 'past_due') {
    return 'critical';
  }

  if (vendor.registrationStatus === 'unregistered') {
    const daysRemaining = vendorEligibility(vendor).daysRemaining;
    if (daysRemaining < 0 || daysRemaining <= 7) {
      return 'critical';
    }
    if (daysRemaining <= 90) {
      return 'warning';
    }
    return 'notice';
  }

  return 'ok';
}

function complianceMessage(vendor) {
  if (vendor.subscriptionStatus === 'past_due') {
    return 'Subscription is past due. Product publishing is paused until payment is restored.';
  }

  if (vendor.registrationStatus === 'unregistered') {
    const daysRemaining = vendorEligibility(vendor).daysRemaining;
    if (daysRemaining < 0) {
      return 'Registration window expired. Business registration is required before this store can appear publicly.';
    }
    return 'Business registration is required before this store and its listings can appear publicly. Registration assistance should be offered.';
  }

  return 'Vendor is compliant.';
}

function canPublishProducts(vendor) {
  return vendor.subscriptionStatus === 'active' && vendor.registrationStatus === 'registered';
}

function isStarterPlan(vendor) {
  return String(vendor.subscriptionPlan || '').toLowerCase().includes('starter');
}

function isPublicVendor(vendor) {
  return vendor.registrationStatus === 'registered'
    && vendor.subscriptionStatus === 'active'
    && !isStarterPlan(vendor);
}

function complianceAlertFor(vendor) {
  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    severity: complianceSeverity(vendor),
    message: complianceMessage(vendor),
    canPublishProducts: canPublishProducts(vendor),
    eligibility: vendorEligibility(vendor)
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': frontendOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Urban-Market-Signature',
    'Content-Type': 'application/json'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body, contentType, headers = {}) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': frontendOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Urban-Market-Signature',
    'Content-Type': contentType,
    ...headers
  });
  res.end(body);
}

function sendBinary(res, statusCode, body, contentType, headers = {}) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': frontendOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Urban-Market-Signature',
    'Content-Type': contentType,
    ...headers
  });
  res.end(body);
}

function csvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function sendRouteError(res, error) {
  logger.error('Route failed', { error: error.message, stack: error.stack });
  sendJson(res, 500, { error: 'Server error' });
}

function requireRouteRoles(req, res, roles) {
  return requireRoles(req, res, roles, sendJson);
}

async function authorizeVendorTarget(authUser, vendorId) {
  if (!authUser || authUser.role === 'admin') return true;
  if (authUser.role !== 'vendor' || !vendorId) return false;
  const vendorIds = await repository.vendorIdsForUser(authUser.sub);
  return vendorIds.includes(vendorId);
}

function readJsonBody(req, maxBytes = 1000000) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error('Request body is too large'));
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1000000) {
        req.destroy();
        reject(new Error('Request body is too large'));
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function orderStageLabel(order) {
  const paymentStatus = order.paymentStatus || order.paymentSessionStatus || 'pending';
  if (paymentStatus !== 'paid') return 'Awaiting payment confirmation';
  if (order.receiptConfirmedAt || Number(order.heldItemCount || 0) === 0 || order.status === 'completed') return 'Received and completed';
  if (order.items?.some((item) => item.fulfillmentStatus === 'fulfilled')) return 'Fulfilled - waiting for customer receipt confirmation';
  return 'Paid - fulfillment pending';
}

function createInvoiceLines(order) {
  const grouped = new Map();
  for (const item of order.items) {
    const storeName = item.storeName || item.vendorName || item.vendor || 'Urban Market JA vendor';
    const group = grouped.get(storeName) || { storeName, items: [], subtotal: 0 };
    group.items.push(item);
    group.subtotal += Number(item.price || 0) * Number(item.qty || item.quantity || 1);
    grouped.set(storeName, group);
  }
  const storeLines = [...grouped.values()].flatMap((store) => [
    `Store: ${store.storeName}`,
    ...store.items.map((item) => {
      const qty = Number(item.qty || item.quantity || 1);
      const price = Number(item.price || 0);
      return `- ${item.name} x${qty} - JMD ${(price * qty).toLocaleString()}`;
    }),
    `Store subtotal: JMD ${store.subtotal.toLocaleString()}`,
    ''
  ]);

  return [
    'Urban Market JA',
    'Logo: Urban Market JA logo',
    `Invoice number: ${order.invoiceNumber}`,
    `Order ID: ${order.orderId}`,
    `Date: ${order.createdAt}`,
    `Order stage: ${orderStageLabel(order)}`,
    '',
    'Stores in this order:',
    ...storeLines,
    `Total: JMD ${order.total.toLocaleString()}`,
    `Payment method: ${order.paymentMethod}`,
    `Payment status: ${order.paymentStatus || order.paymentSessionStatus || 'pending'}`,
    `Payment session: ${order.paymentSessionId || order.paymentSession?.id || 'Not created'}`,
    `Fulfillment status: ${orderStageLabel(order)}`,
    '',
    'Thank you for your order.'
  ];
}

function withEligibility(vendor) {
  return {
    ...vendor,
    eligibility: vendorEligibility(vendor),
    compliance: complianceAlertFor(vendor)
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (!rateLimit(req, res, sendJson)) {
    logger.warn('Rate limit exceeded', { path: url.pathname, method: req.method, ip: req.socket.remoteAddress });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'urban-market-ja-backend', dataMode: databaseMode() });
    return;
  }

  const listingMediaMatch = url.pathname.match(/^\/api\/uploads\/listing-media\/([^/]+)$/);
  if (req.method === 'GET' && listingMediaMatch) {
    if (repository.isDatabaseEnabled()) {
      try {
        const download = repository.listingMediaDownload(listingMediaMatch[1]);
        if (!download) {
          sendJson(res, 404, { error: 'Listing image not found' });
          return;
        }
        const file = await fs.readFile(download.filePath);
        sendBinary(res, 200, file, download.contentType, {
          'Cache-Control': 'public, max-age=86400'
        });
        return;
      } catch {
        sendJson(res, 404, { error: 'Listing image not found' });
        return;
      }
    }
    sendJson(res, 404, { error: 'Listing image not found' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/vendors') {
    if (repository.isDatabaseEnabled()) {
      try {
        const includeAll = url.searchParams.get('all') === 'true';
        if (includeAll && !requireRouteRoles(req, res, ['admin'])) return;
        const dbVendors = await repository.listVendors(!includeAll, !includeAll);
        sendJson(res, 200, dbVendors.map(withEligibility));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, vendors.filter(isPublicVendor).map(withEligibility));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/products') {
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listProducts());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    const registeredVendorIds = new Set(vendors.filter(isPublicVendor).map((vendor) => vendor.id));
    sendJson(res, 200, products.filter((product) => registeredVendorIds.has(product.vendorId)));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/subscriptions/plans') {
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listSubscriptionPlans());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, subscriptionPlans);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/subscriptions/sessions') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listPaymentSessions());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, paymentSessions);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/payments/sessions') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listPaymentSessions());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, paymentSessions);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/payments/events') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listPaymentEvents());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, []);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/finance-summary') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.adminFinanceSummary());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 409, { error: 'Finance summary requires database mode' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/audit-logs') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listAdminAuditLogs({
          action: url.searchParams.get('action'),
          entityType: url.searchParams.get('entityType'),
          entityId: url.searchParams.get('entityId')
        }));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 409, { error: 'Audit logs require database mode' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/compliance/alerts') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listComplianceAlerts(url.searchParams.get('includeResolved') === 'true'));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, vendors.map(complianceAlertFor));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/notifications/vendor') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const vendorIds = authUser.role === 'admin'
          ? (await repository.listVendors()).map((vendor) => vendor.id)
          : await repository.vendorIdsForUser(authUser.sub);
        sendJson(res, 200, await repository.listNotificationsForVendorIds(vendorIds));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, []);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/alerts') {
    const authUser = requireRouteRoles(req, res, ['customer', 'vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.alertsForUser(authUser.sub, authUser.role));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, []);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/compliance/registration-requests') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listRegistrationRequests());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, registrationAssistanceRequests);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    const authUser = requireRouteRoles(req, res, ['customer']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listOrders(authUser.role === 'customer' ? authUser.sub : null));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, orders);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/services') {
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listServices());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, services);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/bookings') {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listBookings(authUser.role === 'customer' ? authUser.sub : null));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, bookings);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/foods') {
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listFoods());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    const registeredVendorIds = new Set(vendors.filter(isPublicVendor).map((vendor) => vendor.id));
    sendJson(res, 200, foods.filter((food) => registeredVendorIds.has(food.vendorId)));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    if (repository.isDatabaseEnabled()) {
      try {
        const includeAll = url.searchParams.get('all') === 'true';
        if (includeAll && !requireRouteRoles(req, res, ['admin'])) return;
        sendJson(res, 200, await repository.listJobs(!includeAll));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    const registeredVendorIds = new Set(vendors.filter(isPublicVendor).map((vendor) => vendor.id));
    sendJson(res, 200, jobs.filter((job) => job.isApproved && (!job.vendorId || registeredVendorIds.has(job.vendorId))));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/applications') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listApplications());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, applications);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/profile/me') {
    const authUser = requireRouteRoles(req, res, ['customer', 'vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.profileForUser(authUser.sub));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, users.find((user) => user.id === authUser.sub) || authUser);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/profile/me') {
    const authUser = requireRouteRoles(req, res, ['customer', 'vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then((body) => repository.updateUserProfile(authUser.sub, body))
        .then((profile) => sendJson(res, 200, profile))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Profile updates require database mode' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/users') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listUsers());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, users);
    return;
  }

  const userStatusMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/status$/);
  if (req.method === 'POST' && userStatusMatch) {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          const user = await repository.updateUserStatus(userStatusMatch[1], body.status);
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'user_status_update',
            entityType: 'user',
            entityId: userStatusMatch[1],
            details: { status: user.status }
          });
          sendJson(res, 200, user);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const userRoleMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/role$/);
  if (req.method === 'POST' && userRoleMatch) {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          if (body.role !== 'admin') {
            sendJson(res, 400, { error: 'Only admin promotion is supported from this screen' });
            return;
          }
          const user = await repository.promoteUserToAdmin(userRoleMatch[1]);
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'user_role_promote_admin',
            entityType: 'user',
            entityId: userRoleMatch[1],
            details: { role: user.role, status: user.status }
          });
          sendJson(res, 200, user);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    const user = users.find((item) => item.id === userRoleMatch[1]);
    if (!user) {
      sendJson(res, 404, { error: 'User not found' });
      return;
    }
    user.role = 'admin';
    user.status = 'active';
    sendJson(res, 200, user);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard/customer') {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.customerDashboard(authUser.sub));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, { orders, bookings, applications });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/cart') {
    const authUser = requireRouteRoles(req, res, ['customer']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.cartForUser(authUser.sub));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, { items: [], count: 0, total: 0 });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/customer/addresses') {
    const authUser = requireRouteRoles(req, res, ['customer']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.listCustomerAddresses(authUser.sub));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, []);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard/admin') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.adminSummary());
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, {
      users: users.length,
      vendors: vendors.length,
      services: services.length,
      bookings: bookings.length,
      applications: applications.length,
      pendingJobs: jobs.filter((job) => !job.isApproved).length,
      complianceAlerts: vendors.map(complianceAlertFor),
      paymentSessions: paymentSessions.length,
      registrationAssistanceRequests: registrationAssistanceRequests.length
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/vendor/operations') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.vendorOperationsForUser(authUser.sub, authUser.role === 'admin'));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 200, { vendors, stores: [], products, services, jobs, documents: [], media: [], registrationRequests: registrationAssistanceRequests });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/vendor-wallets/audit') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const vendorIds = (await repository.listVendors(false)).map((vendor) => vendor.id);
        sendJson(res, 200, await repository.listWalletAuditReport(vendorIds));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 409, { error: 'Wallet audit requires database mode' });
    return;
  }

  const walletAuditRepairMatch = url.pathname.match(/^\/api\/vendor-wallets\/([^/]+)\/audit\/repair$/);
  if (req.method === 'POST' && walletAuditRepairMatch) {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const result = await repository.repairWalletAudit(walletAuditRepairMatch[1], authUser.sub);
        sendJson(res, 200, result);
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 400, { error: error.message || 'Wallet repair failed' });
        return;
      }
    }
    sendJson(res, 409, { error: 'Wallet repair requires database mode' });
    return;
  }

  const walletLedgerExportMatch = url.pathname.match(/^\/api\/vendor-wallets\/([^/]+)\/ledger\.csv$/);
  if (req.method === 'GET' && walletLedgerExportMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const vendorId = walletLedgerExportMatch[1];
        if (!await authorizeVendorTarget(authUser, vendorId)) {
          sendJson(res, 403, { error: 'Vendor account cannot export this wallet ledger' });
          return;
        }
        const entries = await repository.listVendorWalletLedger([vendorId], 10000);
        const header = ['Created at', 'Type', 'Bucket', 'Direction', 'Credits', 'JMD', 'Order', 'Service booking', 'Payment session', 'Checkout request', 'Product', 'Description'];
        const rows = entries.map((entry) => [
          entry.createdAt,
          entry.entryType,
          entry.balanceBucket,
          entry.direction,
          entry.amountCoins,
          entry.amountJmd,
          entry.orderId,
          entry.serviceBookingId,
          entry.paymentSessionId,
          entry.checkoutRequestId,
          entry.productId,
          entry.description
        ]);
        const csv = [header, ...rows].map((row) => row.map(csvValue).join(',')).join('\n');
        sendText(res, 200, csv, 'text/csv; charset=utf-8', {
          'Content-Disposition': `attachment; filename="vendor-${vendorId}-ledger.csv"`
        });
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 409, { error: 'Vendor ledger export requires database mode' });
    return;
  }

  const walletLedgerMatch = url.pathname.match(/^\/api\/vendor-wallets\/([^/]+)\/ledger$/);
  if (req.method === 'GET' && walletLedgerMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const vendorId = walletLedgerMatch[1];
        if (!await authorizeVendorTarget(authUser, vendorId)) {
          sendJson(res, 403, { error: 'Vendor account cannot inspect this wallet ledger' });
          return;
        }
        sendJson(res, 200, await repository.listVendorWalletLedger([vendorId], 10000));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 409, { error: 'Vendor ledger inspection requires database mode' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/vendor-wallets/checkout-requests') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          if (!await authorizeVendorTarget(authUser, body.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot request checkout for this wallet' });
            return;
          }
          const request = await repository.createVendorCheckoutRequest(body, authUser.sub);
          sendJson(res, 201, request);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Vendor wallet checkout requires database mode' });
    return;
  }

  const checkoutRequestStatusMatch = url.pathname.match(/^\/api\/vendor-wallets\/checkout-requests\/([^/]+)\/status$/);
  if (req.method === 'POST' && checkoutRequestStatusMatch) {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          const request = await repository.updateVendorCheckoutRequestStatus(checkoutRequestStatusMatch[1], body);
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'checkout_request_status_update',
            entityType: 'vendor_checkout_request',
            entityId: checkoutRequestStatusMatch[1],
            details: { status: body.status, vendorId: request.vendorId, amountCoins: request.amountCoins }
          });
          sendJson(res, 200, request);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Vendor wallet checkout requires database mode' });
    return;
  }

  const vendorMatch = url.pathname.match(/^\/api\/vendors\/([^/]+)$/);
  if (req.method === 'GET' && vendorMatch) {
    if (repository.isDatabaseEnabled()) {
      try {
        const vendor = await repository.findPublicVendorBySlug(vendorMatch[1]);
        if (!vendor) {
          sendJson(res, 404, { error: 'Vendor not found' });
          return;
        }
        const dbProducts = await repository.listProducts();
        sendJson(res, 200, {
          ...withEligibility(vendor),
          products: dbProducts.filter((product) => product.vendorId === vendor.id)
        });
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    const vendor = vendors.find((item) => item.slug === vendorMatch[1] && isPublicVendor(item));
    if (!vendor) {
      sendJson(res, 404, { error: 'Vendor not found' });
      return;
    }

    sendJson(res, 200, {
      ...withEligibility(vendor),
      products: products.filter((product) => product.vendorId === vendor.id)
    });
    return;
  }

  const assistanceMatch = url.pathname.match(/^\/api\/vendors\/([^/]+)\/registration-assistance$/);
  if (req.method === 'POST' && assistanceMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const vendor = await repository.findVendorBySlug(assistanceMatch[1]);
        if (!vendor) {
          sendJson(res, 404, { error: 'Vendor not found' });
          return;
        }
        if (!await authorizeVendorTarget(authUser, vendor.id)) {
          sendJson(res, 403, { error: 'Vendor account cannot manage this store' });
          return;
        }
        const request = await repository.createRegistrationRequest(assistanceMatch[1], authUser.sub);
        sendJson(res, 202, { status: 'requested', vendor: request.vendor, request });
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
        return;
      }
    }
    const vendor = vendors.find((item) => item.slug === assistanceMatch[1]);
    if (!vendor) {
      sendJson(res, 404, { error: 'Vendor not found' });
      return;
    }

    const request = {
      id: `REG-${Date.now()}`,
      vendorId: vendor.id,
      vendor: vendor.name,
      status: 'requested',
      requestedAt: new Date().toISOString(),
      nextStep: 'Collect business name, TRN, owner ID, and Companies Office registration progress.'
    };
    registrationAssistanceRequests.push(request);

    sendJson(res, 202, {
      status: 'requested',
      vendor: vendor.name,
      request
    });
    return;
  }

  const vendorStatusMatch = url.pathname.match(/^\/api\/vendors\/([^/]+)\/status$/);
  if (req.method === 'POST' && vendorStatusMatch) {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          const vendor = await repository.updateVendorStatus(vendorStatusMatch[1], body);
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'vendor_status_update',
            entityType: 'vendor',
            entityId: vendorStatusMatch[1],
            details: { status: body.status, registrationStatus: body.registrationStatus }
          });
          sendJson(res, 200, vendor);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const vendorSubscriptionMatch = url.pathname.match(/^\/api\/vendors\/([^/]+)\/subscription$/);
  if (req.method === 'POST' && vendorSubscriptionMatch) {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          const vendor = await repository.updateVendorSubscription(vendorSubscriptionMatch[1], body);
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'vendor_subscription_update',
            entityType: 'vendor',
            entityId: vendorSubscriptionMatch[1],
            details: {
              planId: body.planId,
              status: body.status || 'active',
              subscriptionPlan: vendor.subscriptionPlan,
              subscriptionStatus: vendor.subscriptionStatus
            }
          });
          sendJson(res, 200, vendor);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    readJsonBody(req)
      .then((body) => {
        const vendor = vendors.find((item) => item.id === vendorSubscriptionMatch[1]);
        const plan = subscriptionPlans.find((item) => item.id === body.planId);
        if (!vendor || !plan) {
          sendJson(res, 400, { error: 'Vendor subscription update requires a valid vendor and plan' });
          return;
        }
        const nextBilling = new Date();
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        vendor.subscriptionPlan = plan.name;
        vendor.subscriptionStatus = ['trial', 'active', 'past_due', 'cancelled'].includes(body.status) ? body.status : 'active';
        vendor.lastPaymentAt = vendor.subscriptionStatus === 'active' ? new Date().toISOString() : vendor.lastPaymentAt;
        vendor.nextBillingAt = nextBilling.toISOString().split('T')[0];
        sendJson(res, 200, vendor);
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/subscriptions/checkout') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          validateSubscriptionCheckout(body);
          if (!await authorizeVendorTarget(authUser, body.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this store' });
            return;
          }
          const session = await repository.createCheckoutSession(body, frontendOrigin);
          sendJson(res, 201, session);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    readJsonBody(req)
      .then((body) => {
        const vendor = vendors.find((item) => item.id === body.vendorId);
        const plan = subscriptionPlans.find((item) => item.id === body.planId);
        if (!vendor || !plan) {
          sendJson(res, 400, { error: 'Checkout requires a valid vendor and plan' });
          return;
        }

        const session = {
          id: `PAY-${Date.now()}`,
          provider: 'mock-provider',
          vendorId: vendor.id,
          planId: plan.id,
          amount: plan.monthlyPrice,
          status: 'created',
          checkoutUrl: `${frontendOrigin}/vendor-dashboard?payment=${vendor.id}-${plan.id}`,
          createdAt: new Date().toISOString()
        };
        paymentSessions.push(session);
        sendJson(res, 201, session);
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/subscriptions/wallet-pay') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          validateSubscriptionCheckout(body);
          if (!await authorizeVendorTarget(authUser, body.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this wallet payment' });
            return;
          }
          const result = await repository.paySubscriptionWithWallet(body);
          sendJson(res, 200, result);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Wallet payments require database mode' });
    return;
  }

  const mockPaySessionMatch = url.pathname.match(/^\/api\/subscriptions\/sessions\/([^/]+)\/mock-pay$/);
  if (req.method === 'POST' && mockPaySessionMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        if (providerName() !== 'mock') {
          sendJson(res, 409, { error: 'Use the configured payment provider checkout to complete this payment' });
          return;
        }
        const session = await repository.findPaymentSessionById(mockPaySessionMatch[1]);
        if (!session) {
          sendJson(res, 404, { error: 'Payment session not found' });
          return;
        }
        if (!await authorizeVendorTarget(authUser, session.vendorId)) {
          sendJson(res, 403, { error: 'Vendor account cannot manage this payment session' });
          return;
        }
        const result = await repository.completeMockCheckout(mockPaySessionMatch[1], 'vendor_subscription');
        if (authUser.role === 'admin') {
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'payment_session_mark_paid',
            entityType: 'payment_session',
            entityId: mockPaySessionMatch[1],
            details: result
          });
        }
        sendJson(res, 200, result);
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
        return;
      }
    }
    sendJson(res, 409, { error: 'Mock checkout completion requires database mode' });
    return;
  }

  const genericMockPaySessionMatch = url.pathname.match(/^\/api\/payments\/sessions\/([^/]+)\/mock-pay$/);
  if (req.method === 'POST' && genericMockPaySessionMatch) {
    const authUser = requireRouteRoles(req, res, ['customer', 'vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        if (providerName() !== 'mock') {
          sendJson(res, 409, { error: 'Use the configured payment provider checkout to complete this payment' });
          return;
        }
        const session = await repository.findPaymentSessionById(genericMockPaySessionMatch[1]);
        if (!session) {
          sendJson(res, 404, { error: 'Payment session not found' });
          return;
        }
        if (session.orderId) {
          if (!['customer', 'admin'].includes(authUser.role)) {
            sendJson(res, 403, { error: 'Only the customer or admin can complete this order payment' });
            return;
          }
          if (authUser.role === 'customer') {
            const order = await repository.findOrderById(session.orderId, authUser.sub);
            if (!order) {
              sendJson(res, 403, { error: 'Customer account cannot manage this order payment' });
              return;
            }
          }
        } else if (session.serviceBookingId) {
          if (!['customer', 'admin'].includes(authUser.role)) {
            sendJson(res, 403, { error: 'Only the customer or admin can complete this service booking payment' });
            return;
          }
          if (authUser.role === 'customer') {
            const booking = await repository.findBookingById(session.serviceBookingId, authUser.sub);
            if (!booking) {
              sendJson(res, 403, { error: 'Customer account cannot manage this service booking payment' });
              return;
            }
          }
        } else if (session.vendorId) {
          if (!await authorizeVendorTarget(authUser, session.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this payment session' });
            return;
          }
        }
        const result = await repository.completeMockCheckout(genericMockPaySessionMatch[1], session.kind);
        if (authUser.role === 'admin') {
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'payment_session_mark_paid',
            entityType: 'payment_session',
            entityId: genericMockPaySessionMatch[1],
            details: result
          });
        }
        sendJson(res, 200, result);
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
        return;
      }
    }
    sendJson(res, 409, { error: 'Mock checkout completion requires database mode' });
    return;
  }

  const paySessionMatch = url.pathname.match(/^\/api\/subscriptions\/sessions\/([^/]+)\/mark-paid$/);
  if (req.method === 'POST' && paySessionMatch) {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const result = await repository.markPaymentSessionPaid(paySessionMatch[1]);
        await repository.recordAdminAudit({
          adminUserId: authUser.sub,
          action: 'payment_session_mark_paid',
          entityType: 'payment_session',
          entityId: paySessionMatch[1],
          details: result
        });
        sendJson(res, 200, result);
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message, sessionId: error.sessionId });
        return;
      }
    }
    const session = paymentSessions.find((item) => item.id === paySessionMatch[1]);
    if (!session) {
      sendJson(res, 404, { error: 'Payment session not found' });
      return;
    }

    const vendor = vendors.find((item) => item.id === session.vendorId);
    const plan = subscriptionPlans.find((item) => item.id === session.planId);
    session.status = 'paid';
    session.paidAt = new Date().toISOString();

    if (vendor && plan) {
      const nextBilling = new Date();
      nextBilling.setMonth(nextBilling.getMonth() + 1);
      vendor.subscriptionStatus = 'active';
      vendor.subscriptionPlan = plan.name;
      vendor.lastPaymentAt = session.paidAt;
      vendor.nextBillingAt = nextBilling.toISOString().split('T')[0];
    }

    sendJson(res, 200, { session, vendor });
    return;
  }

  const webhookMatch = url.pathname.match(/^\/api\/payments\/webhooks\/([^/]+)$/);
  if (req.method === 'POST' && webhookMatch) {
    if (!repository.isDatabaseEnabled()) {
      sendJson(res, 202, { processed: false, dataMode: 'memory' });
      return;
    }

    const provider = webhookMatch[1];
    if (provider !== providerName()) {
      sendJson(res, 400, { error: 'Webhook provider does not match configured payment provider' });
      return;
    }

    readRawBody(req)
      .then(async (rawBody) => {
        const signature = req.headers['x-urban-market-signature'];
        if (!verifyWebhookSignature(rawBody, Array.isArray(signature) ? signature[0] : signature)) {
          sendJson(res, 401, { error: 'Invalid payment webhook signature' });
          return;
        }
        const payload = parseWebhook(rawBody);
        const eventType = payload.eventType || payload.type;
        const providerEventId = payload.eventId || payload.id;
        if (!eventType || !providerEventId) {
          sendJson(res, 400, { error: 'Webhook requires eventId and eventType' });
          return;
        }
        const result = await repository.processPaymentWebhook({ provider, providerEventId, eventType, payload });
        sendJson(res, 202, result);
      })
      .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid webhook body' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/products') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          validateProduct(body);
          if (!await authorizeVendorTarget(authUser, body.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this store' });
            return;
          }
          const product = await repository.createProduct(body);
          sendJson(res, 201, product);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message, compliance: error.compliance }));
      return;
    }
    readJsonBody(req)
      .then((body) => {
        const vendor = vendors.find((item) => item.id === body.vendorId);
        if (!vendor) {
          sendJson(res, 400, { error: 'Product requires a valid vendor' });
          return;
        }

        if (!canPublishProducts(vendor)) {
          sendJson(res, 403, {
            error: 'Vendor cannot publish products',
            compliance: complianceAlertFor(vendor)
          });
          return;
        }

        const product = {
          id: `p${Date.now()}`,
          name: String(body.name || 'New product'),
          vendorId: vendor.id,
          price: Number(body.price) || 0,
          deliveryDay: String(body.deliveryDay || 'TBD')
        };
        products.push(product);
        sendJson(res, 201, product);
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
    return;
  }

  const storeUpdateMatch = url.pathname.match(/^\/api\/vendors\/([^/]+)\/store$/);
  if (req.method === 'POST' && storeUpdateMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      if (!await authorizeVendorTarget(authUser, storeUpdateMatch[1])) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this store' });
        return;
      }
      readJsonBody(req)
        .then((body) => repository.updateStore(storeUpdateMatch[1], body))
        .then((store) => sendJson(res, 200, store))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const payoutProfileMatch = url.pathname.match(/^\/api\/vendors\/([^/]+)\/payout-profile$/);
  if (req.method === 'POST' && payoutProfileMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      if (!await authorizeVendorTarget(authUser, payoutProfileMatch[1])) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this payout profile' });
        return;
      }
      readJsonBody(req)
        .then((body) => repository.upsertVendorPayoutProfile({ ...body, vendorId: payoutProfileMatch[1] }, authUser.sub))
        .then((profile) => sendJson(res, 200, profile))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Payout profile management requires database mode' });
    return;
  }

  const productFeatureMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/feature$/);
  if (req.method === 'POST' && productFeatureMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForProduct(productFeatureMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot feature this product' });
        return;
      }
      readJsonBody(req)
        .then((body) => repository.featureProductWithWallet(productFeatureMatch[1], body))
        .then((feature) => sendJson(res, 201, feature))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Product featuring requires database mode' });
    return;
  }

  const productUpdateMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
  if (req.method === 'POST' && productUpdateMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForProduct(productUpdateMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this product' });
        return;
      }
      readJsonBody(req)
        .then((body) => repository.updateProduct(productUpdateMatch[1], body))
        .then((product) => sendJson(res, 200, product))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message, compliance: error.compliance }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const productStockMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/stock$/);
  if (req.method === 'POST' && productStockMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForProduct(productStockMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this product stock' });
        return;
      }
      readJsonBody(req)
        .then((body) => repository.updateProductStock(productStockMatch[1], body))
        .then((product) => sendJson(res, 200, product))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/discounts') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          if (!body.vendorId || !body.name || !body.amount) {
            sendJson(res, 400, { error: 'Discount requires vendorId, name, and amount' });
            return;
          }
          if (!await authorizeVendorTarget(authUser, body.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this discount' });
            return;
          }
          const discount = await repository.createDiscount(body);
          sendJson(res, 201, discount);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 201, { ok: true });
    return;
  }

  const discountStatusMatch = url.pathname.match(/^\/api\/discounts\/([^/]+)\/status$/);
  if (req.method === 'POST' && discountStatusMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForDiscount(discountStatusMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this discount' });
        return;
      }
      readJsonBody(req)
        .then((body) => repository.updateDiscountStatus(discountStatusMatch[1], body))
        .then((discount) => sendJson(res, 200, discount))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Discount management requires database mode' });
    return;
  }

  const discountDeleteMatch = url.pathname.match(/^\/api\/discounts\/([^/]+)(?:\/delete)?$/);
  if ((req.method === 'POST' || req.method === 'DELETE') && discountDeleteMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const vendorId = await repository.vendorIdForDiscount(discountDeleteMatch[1]);
        if (!await authorizeVendorTarget(authUser, vendorId)) {
          sendJson(res, 403, { error: 'Vendor account cannot manage this discount' });
          return;
        }
        sendJson(res, 200, await repository.deleteDiscount(discountDeleteMatch[1]));
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
        return;
      }
    }
    sendJson(res, 409, { error: 'Discount management requires database mode' });
    return;
  }

  const productDiscountMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/discounts$/);
  if (req.method === 'POST' && productDiscountMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForProduct(productDiscountMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this product' });
        return;
      }
      readJsonBody(req)
        .then((body) => repository.applyDiscountToProduct(productDiscountMatch[1], body.discountId))
        .then((product) => sendJson(res, 200, product))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Discount management requires database mode' });
    return;
  }

  const productDiscountRemoveMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/discounts\/([^/]+)\/remove$/);
  if (req.method === 'POST' && productDiscountRemoveMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForProduct(productDiscountRemoveMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this product' });
        return;
      }
      repository.removeDiscountFromProduct(productDiscountRemoveMatch[1], productDiscountRemoveMatch[2])
        .then((product) => sendJson(res, 200, product))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Request failed' }));
      return;
    }
    sendJson(res, 409, { error: 'Discount management requires database mode' });
    return;
  }

  const cartDiscountMatch = url.pathname.match(/^\/api\/carts\/([^/]+)\/discounts$/);
  if (req.method === 'POST' && cartDiscountMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          if (!body.vendorId || !body.discountId) {
            sendJson(res, 400, { error: 'Cart discount requires vendorId and discountId' });
            return;
          }
          if (!await authorizeVendorTarget(authUser, body.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this cart offer' });
            return;
          }
          const cart = await repository.offerDiscountToCart(cartDiscountMatch[1], body.vendorId, body.discountId, body);
          sendJson(res, 200, cart);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Discount management requires database mode' });
    return;
  }

  const productImageMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/images$/);
  if (req.method === 'POST' && productImageMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForProduct(productImageMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this product' });
        return;
      }
      readJsonBody(req, 12000000)
        .then((body) => repository.createProductImage(productImageMatch[1], body))
        .then((image) => sendJson(res, 201, image))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 201, { ok: true });
    return;
  }

  const storeMediaMatch = url.pathname.match(/^\/api\/stores\/([^/]+)\/media$/);
  if (req.method === 'POST' && storeMediaMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForStore(storeMediaMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this store' });
        return;
      }
      readJsonBody(req, 12000000)
        .then((body) => repository.createStoreMedia(storeMediaMatch[1], body))
        .then((media) => sendJson(res, 201, media))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 201, { ok: true });
    return;
  }

  const serviceImageMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/images$/);
  if (req.method === 'POST' && serviceImageMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForService(serviceImageMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this service' });
        return;
      }
      readJsonBody(req, 12000000)
        .then((body) => repository.createServiceImage(serviceImageMatch[1], body))
        .then((image) => sendJson(res, 201, image))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 201, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/services') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          if (!await authorizeVendorTarget(authUser, body.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this store' });
            return;
          }
          const service = await repository.createService(body);
          sendJson(res, 201, service);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message, compliance: error.compliance }));
      return;
    }
    sendJson(res, 201, { ok: true });
    return;
  }

  const serviceUpdateMatch = url.pathname.match(/^\/api\/services\/([^/]+)$/);
  if (req.method === 'POST' && serviceUpdateMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForService(serviceUpdateMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this service' });
        return;
      }
      readJsonBody(req)
        .then((body) => repository.updateService(serviceUpdateMatch[1], body))
        .then((service) => sendJson(res, 200, service))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message, compliance: error.compliance }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const serviceMatch = url.pathname.match(/^\/api\/services\/([^/]+)$/);
  if (req.method === 'GET' && serviceMatch) {
    if (repository.isDatabaseEnabled()) {
      try {
        const service = await repository.findServiceById(serviceMatch[1]);
        if (!service) {
          sendJson(res, 404, { error: 'Service not found' });
          return;
        }
        sendJson(res, 200, service);
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    const service = services.find((item) => item.id === serviceMatch[1]);
    if (!service) {
      sendJson(res, 404, { error: 'Service not found' });
      return;
    }

    sendJson(res, 200, service);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/bookings') {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then((body) => repository.createBooking(body, authUser.sub))
        .then((booking) => sendJson(res, 201, booking))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    readJsonBody(req)
      .then((body) => {
        const service = services.find((item) => item.id === body.serviceId);
        if (!service || !body.date || !body.time || !body.location) {
          sendJson(res, 400, { error: 'Booking requires service, date, time, and location' });
          return;
        }

        const booking = {
          id: `BKG-${Date.now()}`,
          serviceId: service.id,
          serviceName: service.name,
          vendor: service.vendor,
          date: body.date,
          time: body.time,
          location: body.location,
          notes: body.notes || '',
          status: 'confirmed',
          bookedAt: new Date().toISOString()
        };
        bookings.push(booking);
        sendJson(res, 201, booking);
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
    return;
  }

  const bookingStatusMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/status$/);
  if (req.method === 'POST' && bookingStatusMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          const bookingVendorId = await repository.vendorIdForBooking(bookingStatusMatch[1]);
          if (!bookingVendorId) {
            sendJson(res, 404, { error: 'Service booking not found' });
            return;
          }
          if (!await authorizeVendorTarget(authUser, bookingVendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this service booking' });
            return;
          }
          const booking = await repository.updateServiceBookingStatus(bookingStatusMatch[1], authUser.role === 'admin' ? null : bookingVendorId, body.status || body.fulfillmentStatus);
          if (authUser.role === 'admin') {
            await repository.recordAdminAudit({
              adminUserId: authUser.sub,
              action: 'service_booking_status_update',
              entityType: 'service_booking',
              entityId: bookingStatusMatch[1],
              details: { status: body.status || body.fulfillmentStatus }
            });
          }
          sendJson(res, 200, booking);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Service booking management requires database mode' });
    return;
  }

  const bookingCompletedMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/confirm-completed$/);
  if (req.method === 'POST' && bookingCompletedMatch) {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const booking = await repository.confirmServiceBookingCompleted(bookingCompletedMatch[1], authUser.sub, authUser.role === 'admin');
        sendJson(res, 200, booking);
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 400, { error: error.message || 'Service completion confirmation failed' });
        return;
      }
    }
    sendJson(res, 409, { error: 'Service completion confirmation requires database mode' });
    return;
  }

  const bookingDisputeMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/dispute$/);
  if (req.method === 'POST' && bookingDisputeMatch) {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          const dispute = await repository.createServiceBookingDispute(bookingDisputeMatch[1], body, authUser.sub, authUser.role);
          if (authUser.role === 'admin') {
            await repository.recordAdminAudit({
              adminUserId: authUser.sub,
              action: 'service_booking_dispute_flagged',
              entityType: 'service_booking',
              entityId: bookingDisputeMatch[1],
              details: dispute
            });
          }
          sendJson(res, 201, dispute);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Service issue could not be recorded' }));
      return;
    }
    sendJson(res, 409, { error: 'Service issue reporting requires database mode' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/customer/addresses') {
    const authUser = requireRouteRoles(req, res, ['customer']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then((body) => {
          validateAddress(body);
          return repository.createCustomerAddress(authUser.sub, body);
        })
        .then((address) => sendJson(res, 201, address))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 201, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/cart/items') {
    const authUser = requireRouteRoles(req, res, ['customer']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then((body) => {
          validateCartItem(body);
          return repository.addCartItem(authUser.sub, body);
        })
        .then((cart) => sendJson(res, 201, cart))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 201, { ok: true });
    return;
  }

  const cartItemUpdateMatch = url.pathname.match(/^\/api\/cart\/items\/([^/]+)$/);
  if (req.method === 'POST' && cartItemUpdateMatch) {
    const authUser = requireRouteRoles(req, res, ['customer']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then((body) => repository.updateCartItem(authUser.sub, cartItemUpdateMatch[1], body.qty))
        .then((cart) => sendJson(res, 200, cart))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const cartItemRemoveMatch = url.pathname.match(/^\/api\/cart\/items\/([^/]+)\/remove$/);
  if (req.method === 'POST' && cartItemRemoveMatch) {
    const authUser = requireRouteRoles(req, res, ['customer']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.removeCartItem(authUser.sub, cartItemRemoveMatch[1]));
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
        return;
      }
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/cart/clear') {
    const authUser = requireRouteRoles(req, res, ['customer']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        sendJson(res, 200, await repository.clearCart(authUser.sub));
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
        return;
      }
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && jobMatch) {
    if (repository.isDatabaseEnabled()) {
      try {
        const job = await repository.findPublicJobById(jobMatch[1]);
        if (!job) {
          sendJson(res, 404, { error: 'Job not found' });
          return;
        }
        sendJson(res, 200, job);
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    const registeredVendorIds = new Set(vendors.filter(isPublicVendor).map((vendor) => vendor.id));
    const job = jobs.find((item) => item.id === jobMatch[1] && item.isApproved && (!item.vendorId || registeredVendorIds.has(item.vendorId)));
    if (!job) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }

    sendJson(res, 200, job);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          if (body.vendorId && !await authorizeVendorTarget(authUser, body.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this store' });
            return;
          }
          const job = await repository.createJob(body, authUser.sub);
          sendJson(res, 201, job);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    readJsonBody(req)
      .then((body) => {
        if (!body.title || !body.employer || !body.location || !body.description) {
          sendJson(res, 400, { error: 'Job requires title, employer, location, and description' });
          return;
        }

        const job = {
          id: `jm${Date.now()}`,
          title: String(body.title),
          employer: String(body.employer),
          category: String(body.category || 'Other'),
          location: String(body.location),
          salary: Number(body.salary) || 0,
          type: String(body.type || 'Contract'),
          postedAt: new Date().toISOString().split('T')[0],
          deadline: String(body.deadline || ''),
          description: String(body.description),
          responsibilities: Array.isArray(body.responsibilities) ? body.responsibilities : [],
          requirements: Array.isArray(body.requirements) ? body.requirements : [],
          contact: String(body.contact || ''),
          isApproved: false,
          status: body.status === 'Draft' ? 'Draft' : 'Published'
        };
        jobs.push(job);
        sendJson(res, 201, job);
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
    return;
  }

  const jobUpdateMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/manage$/);
  if (req.method === 'POST' && jobUpdateMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      const vendorId = await repository.vendorIdForJob(jobUpdateMatch[1]);
      if (!await authorizeVendorTarget(authUser, vendorId)) {
        sendJson(res, 403, { error: 'Vendor account cannot manage this job' });
        return;
      }
      readJsonBody(req)
        .then((body) => repository.updateJob(jobUpdateMatch[1], body))
        .then((job) => sendJson(res, 200, job))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/vendor-documents') {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req, 12000000)
        .then(async (body) => {
          if (!await authorizeVendorTarget(authUser, body.vendorId)) {
            sendJson(res, 403, { error: 'Vendor account cannot manage this document' });
            return;
          }
          const document = await repository.createVendorDocument(body, authUser.sub);
          sendJson(res, 201, document);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 201, { ok: true });
    return;
  }

  const documentDownloadMatch = url.pathname.match(/^\/api\/vendor-documents\/([^/]+)\/download$/);
  if (req.method === 'GET' && documentDownloadMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const document = await repository.findVendorDocumentById(documentDownloadMatch[1]);
        if (!document) {
          sendJson(res, 404, { error: 'Document not found' });
          return;
        }
        if (!await authorizeVendorTarget(authUser, document.vendorId)) {
          sendJson(res, 403, { error: 'This account cannot access this document' });
          return;
        }
        const download = await repository.vendorDocumentDownload(documentDownloadMatch[1]);
        if (!download) {
          sendJson(res, 404, { error: 'Uploaded document file is not available' });
          return;
        }
        const file = await fs.readFile(download.filePath);
        sendBinary(res, 200, file, download.contentType, {
          'Content-Disposition': `attachment; filename="${download.fileName.replace(/"/g, '')}"`
        });
      } catch (error) {
        sendJson(res, error.statusCode || 400, { error: error.message || 'Document could not be downloaded' });
      }
      return;
    }
    sendJson(res, 404, { error: 'Document download requires database mode' });
    return;
  }

  const documentReviewMatch = url.pathname.match(/^\/api\/vendor-documents\/([^/]+)\/review$/);
  if (req.method === 'POST' && documentReviewMatch) {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          const document = await repository.reviewVendorDocument(documentReviewMatch[1], body, authUser.sub);
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'vendor_document_review',
            entityType: 'vendor_document',
            entityId: documentReviewMatch[1],
            details: { status: document?.status }
          });
          sendJson(res, 200, document);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const registrationReviewMatch = url.pathname.match(/^\/api\/compliance\/registration-requests\/([^/]+)$/);
  if (req.method === 'POST' && registrationReviewMatch) {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          const request = await repository.updateRegistrationRequest(registrationReviewMatch[1], body, authUser.sub);
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'registration_assistance_update',
            entityType: 'registration_assistance_request',
            entityId: registrationReviewMatch[1],
            details: { status: request?.status }
          });
          sendJson(res, 200, request);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/compliance/run') {
    const authUser = requireRouteRoles(req, res, ['admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const result = await repository.runComplianceAutomation();
        await repository.recordAdminAudit({
          adminUserId: authUser.sub,
          action: 'compliance_automation_run',
          entityType: 'compliance',
          entityId: null,
          details: result
        });
        sendJson(res, 202, result);
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    sendJson(res, 202, { ranAt: new Date().toISOString(), dataMode: 'memory' });
    return;
  }

  const applyMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/applications$/);
  if (req.method === 'POST' && applyMatch) {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req, 8000000)
        .then((body) => repository.createApplication(applyMatch[1], body, authUser.sub))
        .then((application) => sendJson(res, 201, application))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    readJsonBody(req, 8000000)
      .then((body) => {
        const registeredVendorIds = new Set(vendors.filter(isPublicVendor).map((vendor) => vendor.id));
        const job = jobs.find((item) => item.id === applyMatch[1] && item.isApproved && (!item.vendorId || registeredVendorIds.has(item.vendorId)));
        if (!job || !body.applicantName || !body.phone) {
          sendJson(res, 400, { error: 'Application requires job, applicant name, and phone' });
          return;
        }
        if (!body.resumeDataBase64 || !String(body.resumeName || '').toLowerCase().endsWith('.pdf')) {
          sendJson(res, 400, { error: 'Application requires a PDF resume upload' });
          return;
        }

        const application = {
          id: `APP-${Date.now()}`,
          jobId: job.id,
          jobTitle: job.title,
          employer: job.employer,
          applicantName: String(body.applicantName),
          phone: String(body.phone),
          resumeName: String(body.resumeName || 'Resume attached'),
          message: String(body.message || ''),
          status: 'Pending',
          appliedAt: new Date().toISOString()
        };
        applications.push(application);
        sendJson(res, 201, application);
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
    return;
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (req.method === 'GET' && orderMatch) {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const order = await repository.findOrderById(orderMatch[1], authUser.role === 'customer' ? authUser.sub : null);
        if (!order) {
          sendJson(res, 404, { error: 'Order not found' });
          return;
        }
        sendJson(res, 200, order);
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    const order = orders.find((item) => item.orderId === orderMatch[1]);
    if (!order) {
      sendJson(res, 404, { error: 'Order not found' });
      return;
    }

    sendJson(res, 200, order);
    return;
  }

  const invoiceMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/invoice$/);
  if (req.method === 'GET' && invoiceMatch) {
    const authUser = requireRouteRoles(req, res, ['customer', 'vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const order = await repository.findOrderById(invoiceMatch[1], authUser.role === 'customer' ? authUser.sub : null);
        if (!order) {
          sendJson(res, 404, { error: 'Order not found' });
          return;
        }
        if (authUser.role === 'vendor') {
          const vendorIds = await repository.vendorIdsForUser(authUser.sub);
          if (!order.items.some((item) => vendorIds.includes(item.vendorId))) {
            sendJson(res, 403, { error: 'Vendor account cannot access this invoice' });
            return;
          }
        }
        res.writeHead(200, {
          'Access-Control-Allow-Origin': frontendOrigin,
          'Content-Type': 'text/plain',
          'Content-Disposition': `attachment; filename="${order.invoiceNumber}.txt"`
        });
        res.end(createInvoiceLines(order).join('\n'));
        return;
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    const order = orders.find((item) => item.orderId === invoiceMatch[1]);
    if (!order) {
      sendJson(res, 404, { error: 'Order not found' });
      return;
    }

    res.writeHead(200, {
      'Access-Control-Allow-Origin': frontendOrigin,
      'Content-Type': 'text/plain',
      'Content-Disposition': `attachment; filename="${order.invoiceNumber}.txt"`
    });
    res.end(createInvoiceLines(order).join('\n'));
    return;
  }

  const orderReceivedMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/confirm-received$/);
  if (req.method === 'POST' && orderReceivedMatch) {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      try {
        const order = await repository.confirmOrderReceived(orderReceivedMatch[1], authUser.sub, authUser.role === 'admin');
        sendJson(res, 200, order);
        return;
      } catch (error) {
        sendJson(res, error.statusCode || 400, { error: error.message || 'Receipt confirmation failed' });
        return;
      }
    }
    sendJson(res, 409, { error: 'Receipt confirmation requires database mode' });
    return;
  }

  const orderDisputeMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/dispute$/);
  if (req.method === 'POST' && orderDisputeMatch) {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          const dispute = await repository.createOrderDispute(orderDisputeMatch[1], body, authUser.sub, authUser.role);
          if (authUser.role === 'admin') {
            await repository.recordAdminAudit({
              adminUserId: authUser.sub,
              action: 'order_dispute_flagged',
              entityType: 'order',
              entityId: orderDisputeMatch[1],
              details: dispute
            });
          }
          sendJson(res, 201, dispute);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Order issue could not be recorded' }));
      return;
    }
    sendJson(res, 409, { error: 'Order issue reporting requires database mode' });
    return;
  }

  const orderStatusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (req.method === 'POST' && orderStatusMatch) {
    const authUser = requireRouteRoles(req, res, ['vendor', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          if (authUser.role === 'vendor') {
            const vendorIds = await repository.vendorIdsForUser(authUser.sub);
            const vendorId = vendorIds.includes(body.vendorId) ? body.vendorId : vendorIds[0];
            if (!vendorId) {
              sendJson(res, 403, { error: 'Vendor account cannot manage this order' });
              return;
            }
            const order = await repository.updateOrderFulfillment(orderStatusMatch[1], vendorId, body.fulfillmentStatus || body.status);
            sendJson(res, 200, order);
            return;
          }
          const order = await repository.updateOrderStatus(orderStatusMatch[1], body);
          await repository.recordAdminAudit({
            adminUserId: authUser.sub,
            action: 'order_status_update',
            entityType: 'order',
            entityId: orderStatusMatch[1],
            details: { status: body.status, paymentStatus: body.paymentStatus }
          });
          sendJson(res, 200, order);
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 409, { error: 'Order management requires database mode' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/orders') {
    const authUser = requireRouteRoles(req, res, ['customer', 'admin']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then((body) => repository.createOrder(body, authUser.sub))
        .then((order) => sendJson(res, 201, order))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    readJsonBody(req)
      .then((body) => {
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) {
          sendJson(res, 400, { error: 'Order must include at least one item' });
          return;
        }
        const registeredVendorIds = new Set(vendors.filter(isPublicVendor).map((vendor) => vendor.id));
        if (items.some((item) => !registeredVendorIds.has(String(item.vendorId || '')))) {
          sendJson(res, 409, { error: 'One or more items are no longer available because the store is not registered.' });
          return;
        }

        const normalizedItems = items.map((item) => ({
          productId: String(item.productId || ''),
          name: String(item.name || 'Item'),
          vendorId: String(item.vendorId || ''),
          vendorName: String(item.vendorName || 'Local vendor'),
          price: Number(item.price) || 0,
          deliveryDay: String(item.deliveryDay || 'TBD'),
          qty: Math.max(1, Math.floor(Number(item.qty) || 1))
        }));

        const total = normalizedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
        const order = {
          orderId: `ORD-${Date.now()}`,
          invoiceNumber: `INV-${Date.now()}`,
          status: 'confirmed',
          createdAt: new Date().toISOString(),
          customer: body.customer || {},
          paymentMethod: body.paymentMethod || 'Dime',
          items: normalizedItems,
          total
        };

        orders.push(order);
        sendJson(res, 201, order);
      })
      .catch(() => {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reviews') {
    const authUser = requireRouteRoles(req, res, ['customer']);
    if (!authUser) return;
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then((body) => {
          validateReview(body);
          return repository.createReview(authUser.sub, body);
        })
        .then((review) => sendJson(res, 201, review))
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    sendJson(res, 201, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          validateAuthLogin(body);
          const emailPhone = String(body.emailPhone || body.email || 'member@example.com');
          const password = String(body.password || '');
          const role = ['customer', 'vendor', 'admin'].includes(body.role) ? body.role : null;
          const user = await repository.findUserByEmailPhone(emailPhone, role);
          if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) {
            sendJson(res, 401, { error: 'Invalid login credentials' });
            return;
          }
          const publicUser = safeUser(user);
          currentUser = publicUser;
          sendJson(res, 200, { user: publicUser, token: signToken(publicUser) });
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    readJsonBody(req)
      .then((body) => {
        const emailPhone = String(body.emailPhone || body.email || 'member@example.com');
        const password = String(body.password || '');
        const user = users.find((item) => item.emailPhone === emailPhone);
        if (!user || !password) {
          sendJson(res, 401, { error: 'Invalid login credentials' });
          return;
        }
        currentUser = user;
        sendJson(res, 200, { user, token: `mock-${user.role}-token` });
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/signup') {
    if (repository.isDatabaseEnabled()) {
      readJsonBody(req)
        .then(async (body) => {
          validateSignup(body);
          if (!body.name || !body.emailPhone || !body.role || !body.password) {
            sendJson(res, 400, { error: 'Signup requires name, emailPhone, role, and password' });
            return;
          }
          const user = await repository.createUser({
            name: String(body.name),
            emailPhone: String(body.emailPhone),
            role: body.role === 'vendor' ? 'vendor' : 'customer',
            passwordHash: hashPassword(String(body.password)),
            businessName: body.businessName,
            businessLocation: body.businessLocation,
            storeType: body.storeType
          });
          const publicUser = safeUser(user);
          currentUser = publicUser;
          sendJson(res, 201, { user: publicUser, token: signToken(publicUser) });
        })
        .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid JSON body' }));
      return;
    }
    readJsonBody(req)
      .then((body) => {
        if (!body.name || !body.emailPhone || !body.role) {
          sendJson(res, 400, { error: 'Signup requires name, emailPhone, and role' });
          return;
        }

        const user = {
          id: `${body.role}-${Date.now()}`,
          name: String(body.name),
          emailPhone: String(body.emailPhone),
          role: body.role === 'vendor' ? 'vendor' : 'customer',
          businessName: body.businessName ? String(body.businessName) : undefined,
          businessLocation: body.businessLocation ? String(body.businessLocation) : undefined,
          storeType: body.storeType ? String(body.storeType) : undefined
        };
        users.push(user);
        currentUser = user;
        sendJson(res, 201, { user, token: `mock-${user.role}-token` });
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    currentUser = null;
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

function startComplianceAutomation() {
  if (!config.complianceAutomationEnabled || !repository.isDatabaseEnabled()) {
    return;
  }

  const run = () => {
    repository.runComplianceAutomation()
      .then((result) => console.log('Compliance automation completed', result))
      .catch((error) => console.error('Compliance automation failed', error));
  };

  run();
  const interval = setInterval(run, config.complianceAutomationIntervalMinutes * 60 * 1000);
  if (typeof interval.unref === 'function') {
    interval.unref();
  }
}

server.listen(port, () => {
  logger.info(`Urban Market JA API listening on http://localhost:${port}`, { port, dataMode: databaseMode() });
  startComplianceAutomation();
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});
