# RK Fashion Digital Catalogs

A self-hosted digital catalog studio and editorial flipbook viewer for Rashika Kapoor. Staff can import externally hosted PDFs or upload PDFs, a server-side worker creates optimized page assets, R2 stores the processed assets, and MongoDB stores metadata only.

## Architecture

```text
Static.app PDF URL --server-side download--> temporary Render storage
                                             |
Staff/browser --> Next.js --> MongoDB metadata + job queue
                     |
Public viewer ------> CDN/R2 page assets <-- worker (Poppler + Sharp)
```

External source PDFs remain at their original URL and are only downloaded into temporary processing storage. Public catalog pages use direct CDN/R2 URLs; private/admin assets use signed URLs. The browser never converts the original PDF.

## Local setup

Prerequisites: Node.js 22+, MongoDB, and Poppler installed locally, or Docker.

1. Copy `.env.example` to `.env` and replace `AUTH_SECRET` and the bootstrap password.
2. Run `npm install`.
3. Start MongoDB locally or point `.env` at MongoDB Atlas. Keep `STORAGE_DRIVER=local` for local assets, or configure R2 for an end-to-end storage test.
4. Create the first staff account with `npm run seed:admin`.
5. In separate terminals, run `npm run dev` and `npm run worker`.
6. Open `http://localhost:3000/login`.

The worker requires `pdfinfo` and `pdftoppm`. They are included in the Docker image; on Debian/Ubuntu install `poppler-utils`, and on macOS install `poppler` with Homebrew.

## Cloudflare R2 production settings

Set these server-only variables in Render:

```text
APP_URL=https://lookbookmaker.onrender.com
STORAGE_DRIVER=s3
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_REGION=auto
R2_BUCKET=rk-catalogs
R2_ACCESS_KEY_ID=<server-only-access-key>
R2_SECRET_ACCESS_KEY=<server-only-secret-key>
R2_PUBLIC_BASE_URL=https://cdn.rashikapoorofficial.com
```

`R2_PUBLIC_BASE_URL` must point to a public R2 custom domain or CDN. Public catalog APIs return direct CDN URLs for immutable page assets; the application does not proxy each page through `/api/storage/object`.

Direct browser uploads require R2 bucket CORS. Restrict the origin to the catalog application in production:

```json
[
  {
    "AllowedOrigins": ["https://lookbookmaker.onrender.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The Render start command runs the web server and one catalog worker together. MongoDB job leasing prevents duplicate processing and retries failed jobs with backoff.

For existing URL-backed catalogs, configure R2 and run:

```text
npm run migrate:r2 -- --confirm
```

This queues external-URL catalogs for reprocessing, preserves product links, and does not create permanent source PDF copies.

## Security and operations

- Admin APIs require an HTTP-only signed staff session.
- Upload keys are UUID-based and never use user filenames.
- Unpublished catalogs are never returned by public APIs or routes.
- Uploaded original PDFs download through signed R2 URLs. URL-imported originals redirect to their external source URL.
- Set a 32+ character `AUTH_SECRET`, keep R2 credentials server-only, use TLS, restrict storage CORS, and place the app behind a rate-limiting proxy/WAF in production.
- Configure R2 lifecycle rules for abandoned upload keys and MongoDB backups. Processed assets are immutable and CDN-cacheable.

## API surface

The endpoints under `/api/catalogs` implement CRUD, URL import, optional upload, publish/unpublish, public lookup, secure download, reprocessing, duplication, and view events. Public catalog responses contain backend-generated asset URLs; the frontend never constructs storage URLs itself.
