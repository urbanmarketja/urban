# Backend Production Hardening

Implemented in Phase 8:

- Request validation for auth, product, service, cart, address, and review write paths.
- Basic per-IP/per-route rate limiting.
- Structured JSON logs to console and `Backend/logs/backend.log`.
- Unhandled exception and rejection logging.
- Database backup and restore scripts.
- Smoke test script for auth, checkout, vendor publishing, payments, and compliance.
- Deployment runbook in `DEPLOYMENT.md`.

Useful commands:

```powershell
npm run check
npm run smoke
npm run db:backup
npm run db:restore -- .\backups\urban_market_ja-example.sql
```

Production notes:

- Use strong `JWT_SECRET`, `PASSWORD_PEPPER`, and `PAYMENT_WEBHOOK_SECRET` values.
- Put the Node process behind TLS and a production reverse proxy.
- Store database backups off-server.
- Review `Backend/logs/backend.log` through a log collector in production.
