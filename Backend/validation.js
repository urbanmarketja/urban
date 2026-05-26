function requireFields(body, fields) {
  const missing = fields.filter((field) => {
    const value = body[field];
    return value === undefined || value === null || value === '';
  });

  if (missing.length) {
    const error = new Error(`Missing required fields: ${missing.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
}

function requireOneOf(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    const error = new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
}

function assertPositiveNumber(value, fieldName) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) {
    const error = new Error(`${fieldName} must be a positive number`);
    error.statusCode = 400;
    throw error;
  }
}

function validateAuthLogin(body) {
  requireFields(body, ['emailPhone', 'password']);
  if (body.role) requireOneOf(body.role, ['customer', 'vendor', 'admin'], 'role');
}

function validateSignup(body) {
  requireFields(body, ['name', 'emailPhone', 'password', 'role']);
  requireOneOf(body.role, ['customer', 'vendor'], 'role');
}

function validateProduct(body) {
  requireFields(body, ['vendorId', 'name', 'price']);
  assertPositiveNumber(body.price, 'price');
  if (body.stockQuantity !== undefined) assertPositiveNumber(body.stockQuantity, 'stockQuantity');
  if (body.type) requireOneOf(body.type, ['product', 'food'], 'type');
  if (body.status) requireOneOf(body.status, ['draft', 'published', 'Draft', 'Published'], 'status');
}

function validateService(body) {
  requireFields(body, ['vendorId', 'name', 'category', 'price']);
  assertPositiveNumber(body.price, 'price');
  if (body.status) requireOneOf(body.status, ['draft', 'published', 'Draft', 'Published'], 'status');
}

function validateCartItem(body) {
  requireFields(body, ['productId']);
  if (body.qty !== undefined) assertPositiveNumber(body.qty, 'qty');
}

function validateReview(body) {
  requireFields(body, ['rating']);
  assertPositiveNumber(body.rating, 'rating');
  if (Number(body.rating) < 1 || Number(body.rating) > 5) {
    const error = new Error('rating must be between 1 and 5');
    error.statusCode = 400;
    throw error;
  }
}

function validateSubscriptionCheckout(body) {
  requireFields(body, ['vendorId', 'planId']);
}

function validateAddress(body) {
  requireFields(body, ['addressLine1']);
}

module.exports = {
  requireFields,
  validateAddress,
  validateAuthLogin,
  validateCartItem,
  validateProduct,
  validateReview,
  validateService,
  validateSubscriptionCheckout,
  validateSignup
};
