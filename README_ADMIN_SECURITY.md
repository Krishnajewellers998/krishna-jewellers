# Krishna Jewellers Admin Security

The project now uses a custom Admin ID + Password login.

## Local login
- Admin ID: `krishnaadmin`
- Password: `KJ!Admin#2026-Gold`

The credentials are stored in `.env`, not in the HTML files.

## Important before public deployment
1. Change `ADMIN_PASSWORD` to a new strong password.
2. Change `ADMIN_SESSION_SECRET` to a long random secret.
3. Set `NODE_ENV=production` so the admin session cookie uses HTTPS-only `Secure` mode.
4. Deploy the app over HTTPS.

## Protected areas
- `/admin/*` requires an authenticated admin session.
- All POST/PUT/PATCH/DELETE API requests require an authenticated admin session.
- Customer-facing GET APIs remain public so the website/app can display jewellery and gold rates.
- Admin sessions expire after 12 hours and can be ended with Logout.
