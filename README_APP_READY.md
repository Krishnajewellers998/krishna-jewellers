# Krishna Jewellers — App Ready Setup

## 1. Install dependencies

```bash
npm install
```

## 2. Local run

```bash
npm start
```

Open `http://localhost:3000/`.

## 3. Production admin security

Set these environment variables on the server:

- `NODE_ENV=production`
- `ADMIN_USERNAME=admin` (or your chosen username)
- `ADMIN_PASSWORD=<strong-private-password>`
- `PORT=3000` (or your hosting provider's port)

Do **not** put the password in any HTML/JS file and do not commit a real `.env` file.

The admin area and all data-changing API requests require HTTP Basic Authentication when `ADMIN_PASSWORD` is configured.

## 4. App conversion

The website uses relative API URLs such as `/api/categories` and `/api/jewellery`. When the app wraps the hosted website, keep the same hosted origin so these APIs continue to work without hard-coded localhost URLs.

Do not use `localhost` as the production API address inside the app.

## 5. Performance

Existing images have been losslessly/visually-safe optimized where possible and large JPEGs were resized to a mobile-friendly maximum. File names and data references were preserved.

## 6. Health check

`GET /api/health` returns a small JSON health response and can be used by hosting/monitoring.
