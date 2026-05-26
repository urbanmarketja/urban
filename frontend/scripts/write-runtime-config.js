const fs = require('fs');
const path = require('path');

const apiBase = process.env.FRONTEND_API_BASE || process.env.URBAN_MARKET_API_BASE || '';
const publicDir = path.join(__dirname, '..', 'public');
const configPath = path.join(publicDir, 'runtime-config.js');

fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(
  configPath,
  `window.URBAN_MARKET_API_BASE = ${JSON.stringify(apiBase.replace(/\/+$/, ''))};\n`,
  'utf8'
);
console.log(`Runtime API base written: ${apiBase || '(relative /api)'}`);
