const http = require('http');
const { signWebhookPayload } = require('../payments');

const base = process.env.SMOKE_BASE_URL || 'http://localhost:4000';
const password = process.env.DEV_DEFAULT_PASSWORD || 'Password123!';

function request(method, path, body, token, headers = {}) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const options = {
      method,
      headers: {
        ...(raw ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      }
    };

    const req = http.request(`${base}${path}`, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let payload = null;
        try {
          payload = data ? JSON.parse(data) : null;
        } catch (parseError) {
          const error = new Error(`Invalid JSON from ${method} ${path}: ${parseError.message}`);
          error.statusCode = res.statusCode;
          error.raw = data;
          reject(error);
          return;
        }
        if (res.statusCode >= 400) {
          const error = new Error(payload?.error || payload?.message || `HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.payload = payload;
          error.method = method;
          error.path = path;
          error.raw = data;
          reject(error);
          return;
        }
        resolve(payload);
      });
    });

    req.on('error', (requestError) => {
      requestError.method = method;
      requestError.path = path;
      reject(requestError);
    });
    req.end(raw);
  });
}

async function main() {
  const health = await request('GET', '/api/health');
  const admin = await request('POST', '/api/auth/login', { emailPhone: 'owner@urbanmarket.jm', password });
  const customer = await request('POST', '/api/auth/login', { emailPhone: 'member@example.com', password });
  const vendor = await request('POST', '/api/auth/login', { emailPhone: 'vendor@urbanmarket.jm', password });

  await request('POST', '/api/cart/clear', {}, customer.token);
  await request('POST', '/api/cart/items', { productId: 'p1', qty: 1 }, customer.token);
  await request('POST', '/api/cart/items', { productId: 'p2', qty: 1 }, customer.token);
  const order = await request('POST', '/api/orders', { customer: { name: 'Smoke Test', address: 'Kingston' }, paymentMethod: 'Dime' }, customer.token);
  if (order.paymentSession?.id) {
    await request('POST', `/api/payments/sessions/${encodeURIComponent(order.paymentSession.id)}/mock-pay`, {}, customer.token);
  }

  const draft = await request('POST', '/api/products', {
    vendorId: 'v1',
    type: 'product',
    name: `Smoke Draft ${Date.now()}`,
    category: 'Products',
    price: 100,
    deliveryDay: 'Fri',
    status: 'draft'
  }, vendor.token);
  const checkout = await request('POST', '/api/subscriptions/checkout', { vendorId: 'v1', planId: 'starter' }, vendor.token);
  const webhookPayload = JSON.stringify({ eventId: `evt-${Date.now()}`, eventType: 'subscription.payment.paid', sessionId: checkout.id });
  await request('POST', '/api/payments/webhooks/mock', webhookPayload, null, { 'X-Urban-Market-Signature': signWebhookPayload(webhookPayload) });
  const compliance = await request('POST', '/api/compliance/run', {}, admin.token);

  console.log(JSON.stringify({
    ok: true,
    dataMode: health.dataMode,
    orderId: order.orderId,
    draftProductId: draft.id,
    checkoutSessionId: checkout.id,
    compliance
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    method: error.method,
    path: error.path,
    statusCode: error.statusCode,
    payload: error.payload,
    raw: error.raw
    , stack: error.stack
  }, null, 2));
  process.exit(1);
});
