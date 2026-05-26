function createRateLimiter({ windowMs, maxRequests }) {
  const buckets = new Map();

  return function rateLimit(req, res, sendJson) {
    const now = Date.now();
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.url?.split('?')[0] || '/'}`;
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > maxRequests) {
      sendJson(res, 429, {
        error: 'Too many requests. Please retry shortly.',
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000)
      });
      return false;
    }

    if (buckets.size > 10000) {
      for (const [bucketKey, value] of buckets.entries()) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    return true;
  };
}

module.exports = {
  createRateLimiter
};
