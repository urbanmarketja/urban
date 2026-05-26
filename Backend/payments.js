const crypto = require('crypto');
const config = require('./config');

function webhookSecret() {
  return config.paymentWebhookSecret || config.jwtSecret;
}

function signWebhookPayload(rawBody) {
  return crypto.createHmac('sha256', webhookSecret()).update(rawBody).digest('hex');
}

function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return false;
  const expected = signWebhookPayload(rawBody);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function providerName() {
  return config.paymentProvider || 'mock';
}

function buildSubscriptionCheckout({ sessionId, frontendOrigin, vendorId, planCode }) {
  const provider = providerName();
  if (provider !== 'mock') {
    return {
      provider,
      providerSessionId: `${provider}_${sessionId}`,
      checkoutUrl: `${frontendOrigin}/vendor-dashboard?paymentSession=${sessionId}`
    };
  }

  return {
    provider,
    providerSessionId: `mock_${sessionId}`,
    checkoutUrl: `${frontendOrigin}/vendor-dashboard?paymentSession=${sessionId}&vendor=${vendorId}&plan=${planCode}`
  };
}

function buildOrderCheckout({ sessionId, frontendOrigin, orderId }) {
  const provider = providerName();
  if (provider !== 'mock') {
    return {
      provider,
      providerSessionId: `${provider}_${sessionId}`,
      checkoutUrl: `${frontendOrigin}/checkout?paymentSession=${sessionId}`
    };
  }

  return {
    provider,
    providerSessionId: `mock_${sessionId}`,
    checkoutUrl: `${frontendOrigin}/checkout?paymentSession=${sessionId}&order=${orderId}`
  };
}

function buildServiceCheckout({ sessionId, frontendOrigin, serviceId, bookingId }) {
  const provider = providerName();
  if (provider !== 'mock') {
    return {
      provider,
      providerSessionId: `${provider}_${sessionId}`,
      checkoutUrl: `${frontendOrigin}/services/${serviceId}?paymentSession=${sessionId}`
    };
  }

  return {
    provider,
    providerSessionId: `mock_${sessionId}`,
    checkoutUrl: `${frontendOrigin}/services/${serviceId}?paymentSession=${sessionId}&booking=${bookingId}`
  };
}

function parseWebhook(rawBody) {
  return JSON.parse(rawBody || '{}');
}

module.exports = {
  buildOrderCheckout,
  buildServiceCheckout,
  buildSubscriptionCheckout,
  parseWebhook,
  providerName,
  signWebhookPayload,
  verifyWebhookSignature
};
