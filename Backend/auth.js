const crypto = require('crypto');
const config = require('./config');

const TOKEN_TTL_SECONDS = 60 * 60 * 8;
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto
    .pbkdf2Sync(`${password}${config.passwordPepper}`, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)
    .toString('base64url');
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash === 'dev-placeholder-hash') {
    return password === config.devDefaultPassword;
  }

  const [scheme, iterations, salt, expectedHash] = String(storedHash).split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expectedHash) return false;

  const actualHash = crypto
    .pbkdf2Sync(`${password}${config.passwordPepper}`, salt, Number(iterations), PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)
    .toString('base64url');

  if (actualHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash));
}

function signToken(user) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    role: user.role,
    name: user.name,
    emailPhone: user.emailPhone,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${payload}`).digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const claims = JSON.parse(fromBase64url(payload));
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

function getAuthUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return verifyToken(token);
}

function requireRoles(req, res, roles, sendJson) {
  const authUser = getAuthUser(req);
  if (!authUser) {
    sendJson(res, 401, { error: 'Authentication required' });
    return null;
  }

  if (!roles.includes(authUser.role)) {
    sendJson(res, 403, { error: 'This account role cannot access this route' });
    return null;
  }

  return authUser;
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

module.exports = {
  getAuthUser,
  hashPassword,
  requireRoles,
  safeUser,
  signToken,
  verifyPassword,
  verifyToken
};
