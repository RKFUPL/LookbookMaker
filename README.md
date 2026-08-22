# RK Fashion Digital Lookbooks

A self-hosted Next.js catalog studio and editorial flipbook viewer for Rashika Kapoor. Staff provide an HTTPS PDF URL; the server downloads it to temporary storage, Poppler renders its pages, Sharp generates optimized WebP assets, Render Persistent Disk keeps those assets across restarts, and MongoDB stores catalog metadata and job state.

No Cloudflare R2, S3, Wix, external object store, manual page conversion, or browser-side PDF processing is required.

## Architecture

```text
External HTTPS PDF
        |
        | server-side streamed download
        v
temporary PDF -> Poppler + Sharp worker -> /var/data/objects/catalogs/{catalogId}/
                                              |
                                              v
                                     MongoDB page metadata
                                              |
                                              v
Next.js viewer <- /api/storage/object?key=... <- persistent page images
```

The external URL remains the PDF source of truth in MongoDB as `sourceType: external_url` and `sourcePdfUrl`. Temporary PDFs and intermediate JPEGs are removed after every attempt.

Generated files use immutable, versioned keys:

```text
/var/data/objects/
  catalogs/{catalogId}/assets/{assetVersion}/
    large/0001.webp
    medium/0001.webp
    thumb/0001.webp
```

Public asset responses use `Cache-Control: public, max-age=31536000, immutable`. Missing metadata or files return 404; a missing generated file also marks the catalog with `failureCode: storage_missing` so staff can reprocess it.

## Catalog workflow

1. In the staff studio, enter Catalog name, Collection, Description, and PDF URL.
2. Select **IMPORT & CREATE LOOKBOOK**.
3. The MongoDB-backed worker reports `downloading`, then `processing`, and finally `ready`.
4. Preview the generated image-based flipbook and publish it.
5. The public catalog is available at `/catalog/{slug}`. Slugs are created from the catalog title.

The UI reports download, page rendering, thumbnail generation, and catalog-saving progress. A failed job uses status `failed` plus one of these recovery codes:

- `download_failed` — Retry
- `processing_failed` — Retry processing
- `storage_missing` — Reprocess

Reprocessing downloads `sourcePdfUrl` again, generates a new immutable asset version, verifies every large, medium, and thumbnail file, swaps MongoDB metadata only after verification succeeds, and then removes the old asset version.

## Local development

Prerequisites: Node.js 22+, MongoDB, and Poppler (`pdfinfo` and `pdftoppm`), or Docker.

1. Copy `.env.example` to `.env`, set MongoDB credentials, and replace `AUTH_SECRET` and the bootstrap password.
2. Install packages with `npm install`.
3. Create the first account with `npm run seed:admin`.
4. In separate terminals, run `npm run dev` and `npm run worker`.
5. Open `http://localhost:3000/login`.

Development assets default to `./data/objects` and can be changed with `LOCAL_STORAGE_ROOT`.

Docker Compose mounts a named volume at `/var/data/objects` and starts the web server and catalog worker together:

```text
docker compose up --build
docker compose --profile setup run --rm seed-admin
```

## Render production deployment

The web service must have a paid Render Persistent Disk configured exactly as follows:

```text
Mount path: /var/data/objects
```

The included `render.yaml` creates a single service instance with a 10 GB disk at that path and sets:

```text
APP_URL=https://lookbookmaker.onrender.com
LOCAL_STORAGE_ROOT=/var/data/objects
```

Set `MONGODB_URI`, `AUTH_SECRET`, and `BOOTSTRAP_ADMIN_PASSWORD` as Render secrets. Do not add storage-provider or object-store credentials.

The `npm run start:render` startup command refuses to launch in production unless:

- `APP_URL` is a public HTTPS origin;
- the configured storage root is exactly `/var/data/objects`;
- that directory exists and is writable; and
- both Poppler tools are available.

When the disk check fails, startup exits with:

```text
Persistent catalog storage is not mounted at /var/data/objects.
```

There is no fallback to an ephemeral production directory. `/api/health/storage` performs the same writable-disk check.

## Restart-safety acceptance test

Use this source:

```text
https://gentle-kangaroo.staticdomains.app/SANDOOKLOOKBOOK.pdf
```

1. Create and process **Sandook Lookbook**.
2. Confirm the catalog becomes ready, then preview and publish it.
3. Open `/catalog/sandook-lookbook`, navigate forward and backward, and refresh.
4. In the Render dashboard, restart or redeploy the service.
5. Open the same URL and verify its cover, pages, thumbnails, and navigation still work.
6. Confirm generated files remain under `/var/data/objects/catalogs/{catalogId}/assets/{assetVersion}/`.

If assets disappear after restart, the Render disk is not mounted at the required path. Do not work around that failure with container-local storage.

## Security and operational notes

- Admin APIs require an HTTP-only signed staff session.
- Remote imports require HTTPS, reject credentials and private/internal hosts, validate redirect targets, stream with an enforced byte limit, and verify the PDF signature before Poppler opens the file.
- The worker caps PDFs at 1,000 pages and at `MAX_PDF_SIZE_MB`.
- Public viewers receive processed image URLs, never the original PDF for page rendering.
- Run only one Render service instance with this attached disk; MongoDB job leasing still prevents duplicate work within the web/worker process pair.
