# Urban Market JA Deployment Guide

This project is prepared for:

- Netlify for the Angular frontend.
- Render for the Node API.
- Aiven MySQL for production data.

Deploy in this order: Aiven, Render, then Netlify.

## Deployment Files Added

- `.nvmrc` pins Node 22 for hosting platforms that read it.
- `render.yaml` defines the Render API service, migration command, health check, persistent upload disk, and production environment variables.
- `netlify.toml` defines the Angular build, publish directory, SPA fallback, and runtime config cache policy.
- `frontend/public/runtime-config.js` and `frontend/scripts/write-runtime-config.js` let Netlify inject the Render API URL at build time.

## 1. Aiven MySQL

Create a MySQL service in Aiven and collect:

- Host
- Port
- Database name
- User
- Password
- CA certificate

Download the Aiven CA certificate. On Render, either paste it into `DB_SSL_CA` with escaped newlines or upload it as a secret file and set `DB_SSL_CA_PATH`.

Required backend database settings:

```env
USE_DATABASE=true
DB_HOST=your-aiven-host
DB_PORT=your-aiven-port
DB_NAME=your-aiven-database
DB_USER=your-aiven-user
DB_PASSWORD=your-aiven-password
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true
DB_SSL_CA_PATH=/etc/secrets/aiven-ca.pem
# Or use DB_SSL_CA instead of DB_SSL_CA_PATH.
```

## 2. Render API

Use `render.yaml` as the Render Blueprint.

Render service settings:

- Root directory: `Backend`
- Build command: `npm ci`
- Pre-deploy command: `npm run db:migrate`
- Start command: `npm start`
- Health check path: `/api/health`

Required Render environment variables:

```env
NODE_ENV=production
NODE_VERSION=22
USE_DATABASE=true
FRONTEND_ORIGIN=https://your-netlify-site.netlify.app
DB_HOST=your-aiven-host
DB_PORT=your-aiven-port
DB_NAME=your-aiven-database
DB_USER=your-aiven-user
DB_PASSWORD=your-aiven-password
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true
DB_SSL_CA_PATH=/etc/secrets/aiven-ca.pem
JWT_SECRET=long-random-secret
PASSWORD_PEPPER=long-random-pepper
PAYMENT_PROVIDER=mock
PAYMENT_WEBHOOK_SECRET=long-random-webhook-secret
UPLOAD_DIR=/var/data/urban-market-ja/uploads/resumes
COMPLIANCE_AUTOMATION_ENABLED=true
```

Important Render notes:

- `PAYMENT_PROVIDER=mock` keeps the current internal payment-credit workflow active. It records customer payment completion inside the site, creates vendor credits, places those credits on hold, and releases them after fulfillment and customer receipt confirmation. It does not connect to a live card/bank provider yet.
- The blueprint uses a persistent disk for uploaded files. Uploaded media is also backed up to the `uploaded_media` table so product photos, store photos, service photos, resumes, vendor documents, and customization images survive deploys and filesystem resets.
- `FRONTEND_ORIGIN` must exactly match the public Netlify URL, including `https://`.
- Run `npm run db:seed` only if you intentionally want the demo users, vendors, jobs, listings, orders, and test data in that database.

After Render deploys, run:

```powershell
curl https://your-render-service.onrender.com/api/health
```

The response should show `ok: true` and `dataMode: mysql`.

## 3. Netlify Frontend

Use the root `netlify.toml`.

Netlify build settings:

- Base directory: `frontend`
- Build command: `npm ci && npm run build:netlify`
- Publish directory: `frontend/dist/frontend/browser`
- Node version: `22`

Set this Netlify environment variable:

```env
FRONTEND_API_BASE=https://your-render-service.onrender.com
```

The frontend writes this into `public/runtime-config.js` during build, so all browser API calls point to Render instead of `localhost`.

If the Render URL changes, update `FRONTEND_API_BASE` in Netlify and trigger a new frontend deploy.

## 4. Local Deployment Checks

Backend:

```powershell
cd Backend
npm run check
npm run db:migrate
npm run smoke
```

Frontend:

```powershell
cd frontend
npm run build
```

Netlify build simulation:

```powershell
cd frontend
$env:FRONTEND_API_BASE="https://your-render-service.onrender.com"
npm run build:netlify
```

## 5. Production Verification

Before calling the deployment ready, check these flows on the live Netlify site:

- Marketplace loads products, foods, services, and jobs from the Render API.
- Unregistered vendor stores and their listings are not shown publicly.
- Customer sign up, sign in, cart, checkout, invoice, dashboard, alerts, reviews, and receipt confirmation work.
- Vendor sign in, dashboard, stock management, discounts, subscriptions, wallet/credits, order fulfillment, and payout request flows work.
- Admin sign in, vendor management, job management, store moderation, payout review, alerts, and compliance tools work.
- Resume PDF upload works from a live job application.
- `/api/health` reports `ok: true` and `dataMode: mysql`.

## 6. Production Notes

- Do not use the default `JWT_SECRET`, `PASSWORD_PEPPER`, or `PAYMENT_WEBHOOK_SECRET` in production.
- Keep `FRONTEND_ORIGIN` on Render exactly matched to the Netlify site URL.
- File uploads use `UPLOAD_DIR`; Render should have a persistent disk mounted for this path. The `uploaded_media` table is the database fallback if the filesystem copy is missing.
- Customer payments are still handled through the current internal/mock payment confirmation flow until a real provider is connected.
- Store Aiven credentials and CA certificates only in platform secrets, not in the repository.
- Use `Backend/scripts/backup-db.js` for database backups and store production backups outside Render.
