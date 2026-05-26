require('./load-env')();

const config = {
  port: Number(process.env.PORT) || 4000,
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:4200',
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: Number(process.env.DB_PORT) || 3306,
  dbName: process.env.DB_NAME || 'urban_market_ja',
  dbUser: process.env.DB_USER || 'urban_market',
  dbPassword: process.env.DB_PASSWORD || '',
  dbSsl: process.env.DB_SSL === 'true',
  dbSslCa: process.env.DB_SSL_CA || '',
  dbSslCaPath: process.env.DB_SSL_CA_PATH || '',
  dbSslRejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  useDatabase: process.env.USE_DATABASE === 'true',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  passwordPepper: process.env.PASSWORD_PEPPER || 'dev-only-pepper',
  uploadDir: process.env.UPLOAD_DIR || '',
  devDefaultPassword: process.env.DEV_DEFAULT_PASSWORD || 'Password123!',
  paymentProvider: process.env.PAYMENT_PROVIDER || 'mock',
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
  complianceAutomationEnabled: process.env.COMPLIANCE_AUTOMATION_ENABLED !== 'false',
  complianceAutomationIntervalMinutes: Number(process.env.COMPLIANCE_AUTOMATION_INTERVAL_MINUTES) || 360,
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 120
};

module.exports = config;
