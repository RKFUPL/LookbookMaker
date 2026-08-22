# RK Lookbook Maker

RK Lookbook Maker is a Next.js catalog studio and custom flipbook viewer for Rashika Kapoor. It runs on Render Free without a persistent disk: MongoDB stores catalog metadata and the original PDF remains at the external HTTPS URL supplied by staff.

## Architecture

```text
External HTTPS PDF (server-fetchable)
        ↓
MongoDB catalog metadata
        ↓
Next.js on Render Free
        ↓
`/api/catalogs/:id/pdf` streaming proxy
        ↓
PDF.js in the browser → custom RK page-flip UI
```

The viewer reads PDF metadata first, renders only the visible pages plus a small background window, keeps a bounded canvas cache, and lazily renders thumbnails. No generated page files are written or served by the application.

## Local development

Prerequisites: Node.js 22+ and MongoDB.

```bash
npm install
cp .env.example .env
npm run dev
```

Set `MONGODB_URI`, `AUTH_SECRET` (at least 32 characters), and `APP_URL`. `APP_URL` is required in production for canonical links and sharing.

Create a staff account with `npm run seed:admin`, then open `/admin/catalogs/new`. Use an HTTPS PDF URL that Render can fetch; browser CORS headers on the source host are not required. The import action stores the URL and metadata immediately; it does not start a server worker.

## Render Free deployment

`render.yaml` defines one Docker web service with no disk mount. Set the MongoDB and authentication secrets in Render. The startup command validates the application configuration and starts Next.js only. `/api/health/storage` intentionally reports `external PDF mode` so Render can health-check the service without filesystem assumptions.

## Source PDF requirements

- HTTPS URL with no embedded credentials.
- The PDF host should return `Content-Type: application/pdf`; byte-range requests are forwarded for the best loading experience.
- If the source is unavailable or invalid, the viewer shows: `Unable to load the source PDF.`

Analytics requests are non-blocking. The public viewer supports direct `?page=N` links, spreads, touch/mouse page turns, zoom, fullscreen, thumbnails, sharing, and the original PDF download link.
