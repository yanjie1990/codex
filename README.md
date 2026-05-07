# imgcraft AI Login

imgcraft AI site with Google login, admin access, and language split pages.

## Pages

- English: `/index.html`
- Chinese: `/zh/index.html`
- Product Angle Generator: `/product-angle-generator/`
- Image to 3D Converter: `/image-to-3d-converter/`
- Admin: `/admin/index.html`

## Run locally

```bash
npm run dev
```

Open: `http://127.0.0.1:5173`

Quality gates:

```bash
npm run lint
npm test
npm run build
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the production env var matrix, PayPal live/sandbox split, and webhook setup.

## Structure

- `index.html` - English entry with login and tool shell
- `zh/index.html` - Chinese entry
- `product-angle-generator/index.html` - commercial SEO support page
- `image-to-3d-converter/index.html` - comparison/educational SEO support page
- `admin/index.html` - admin console
- `robots.txt` / `sitemap.xml` - crawl and discovery files
- `src/styles.css` - shared styles
- `src/site.js` - shared behavior
- `assets/` - brand and showcase assets
