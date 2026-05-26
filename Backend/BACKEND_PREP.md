# Backend Prep Notes

The backend is now prepared for MySQL without breaking the current mock server.

## Current Mode

`server.js` still runs with in-memory arrays by default.

This keeps the Angular app functional while database setup is pending.

## Database Mode

To use MySQL:

1. Create a MySQL database.
2. Install the database driver:

```bash
npm install mysql2
```

3. Copy `.env.example` to `.env`.
4. Set:

```bash
DB_HOST=localhost
DB_PORT=3306
DB_NAME=urban_market_ja
DB_USER=urban_market
DB_PASSWORD=your-password
USE_DATABASE=true
```

5. Apply schema:

```bash
npm run db:migrate
```

6. Add development seed data:

```bash
npm run db:seed
```

## Next Implementation Step

Replace direct in-memory arrays in `server.js` with repository modules under `repositories/`.

Start with this order:

1. Users/auth/profile.
2. Vendors/stores/subscriptions/compliance.
3. Products/services/foods.
4. Orders/bookings/jobs/applications.
5. Admin dashboards and reports.

## Security Work Still Needed

- Password hashing with `bcrypt` or `argon2`.
- Real sessions or JWT verification middleware.
- Role-based route guards for admin/vendor/customer APIs.
- Payment webhook signature verification.
- Database transactions for checkout/order creation.
