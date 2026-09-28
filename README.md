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

WorkDrive uploads require a Zoho OAuth client with `WorkDrive.files.CREATE` and
`WorkDrive.files.READ` scopes, plus a dedicated folder ID. Configure the
server-only `ZOHO_WORKDRIVE_CLIENT_ID`, `ZOHO_WORKDRIVE_CLIENT_SECRET`,
`ZOHO_WORKDRIVE_REFRESH_TOKEN`, and `ZOHO_WORKDRIVE_FOLDER_ID` variables. Set
the API, upload, download, and OAuth token URLs to the domains for your Zoho
data center; the example uses US. India uses `zohoapis.in`, `upload.zoho.in`,
`download.zoho.in`, and the corresponding accounts domain. Uploads default to
100 MB and cannot exceed WorkDrive's normal 250 MB upload API limit.

Uploads treat `ZOHO_WORKDRIVE_FOLDER_ID` as the root Lookbooks folder, then
find or create a case-insensitive collection subfolder. PDFs use the sanitized
catalog name; collisions receive a timestamp suffix. The catalog stores the
WorkDrive file and collection-folder IDs. Existing WorkDrive files are kept
when a catalog is replaced.

For local India-region setup, use the Self Client application's client ID and
client secret with the refresh token generated from its authorization code. An
authorization code is temporary and must first be exchanged at
`https://accounts.zoho.in/oauth/v2/token`; do not store the authorization code
itself as `ZOHO_WORKDRIVE_REFRESH_TOKEN`. The admin WorkDrive settings page
tests the refresh token and root folder server-side.

On local Windows installations where Node reports `127.0.0.1` as its DNS
server and Atlas SRV lookup fails, the application automatically uses
Cloudflare and Google DNS for non-production MongoDB connections. You can
override that without changing the Atlas URI by setting
`MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` in the process environment. This setting
is ignored in production.

Create a staff account with `npm run seed:admin`, then open `/admin/catalogs/new`. Use an HTTPS PDF URL that Render can fetch; browser CORS headers on the source host are not required. The import action stores the URL and metadata immediately; it does not start a server worker.

## Render Free deployment

`render.yaml` defines one Docker web service with no disk mount. Set the MongoDB and authentication secrets in Render. The startup command validates the application configuration and starts Next.js only. `/api/health/storage` intentionally reports `external PDF mode` so Render can health-check the service without filesystem assumptions.

## Source PDF requirements

- HTTPS URL with no embedded credentials.
- The PDF host should return `Content-Type: application/pdf`; byte-range requests are forwarded for the best loading experience.
- If the source is unavailable or invalid, the viewer shows: `Unable to load the source PDF.`

Analytics requests are non-blocking. The public viewer supports direct `?page=N` links, spreads, touch/mouse page turns, zoom, fullscreen, thumbnails, sharing, and the original PDF download link.
