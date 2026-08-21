# RK Fashion Digital Catalogs

A self-hosted digital catalog studio and editorial flipbook viewer for Rashika Kapoor. Staff upload PDFs directly to S3-compatible object storage, a separate worker creates optimized page assets, and MongoDB stores metadata only.

## Architecture

```text
Browser ──direct signed PUT──> R2 / S3 / MinIO
   │                                │
   ├──staff API──> Next.js ─────> MongoDB metadata + job queue
   │                                │
   └──viewer──> CDN/signed pages <── PDF worker (Poppler + Sharp)
```

The source PDF remains private. Viewer pages and thumbnails use a configured CDN URL or expiring signed URLs. Processing renders and uploads one page at a time, and the reader only mounts the visible spread plus lazy thumbnails.

## Local setup

Prerequisites: Node.js 22+ and either MongoDB/object storage/Poppler installed locally, or Docker.

1. Copy `.env.example` to `.env` and replace `AUTH_SECRET` and the bootstrap password.
2. Run `npm install`.
3. Start infrastructure with `docker compose up -d mongo minio create-bucket` (or point `.env` at MongoDB Atlas and R2/S3).
4. Create the first staff account with `npm run seed:admin`.
5. In separate terminals, run `npm run dev` and `npm run worker`.
6. Open `http://localhost:3000/login`.

For an all-container setup, run `docker compose --profile setup run --rm seed-admin`, then `docker compose up -d app worker`. The MinIO console is at `http://localhost:9001`.

The worker requires `pdfinfo` and `pdftoppm`. They are included in the Docker image; on Debian/Ubuntu install `poppler-utils`, and on macOS install `poppler` with Homebrew.

## Cloudflare R2 / S3 production settings

Set `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, credentials, and `S3_FORCE_PATH_STYLE` as required by the provider. For R2, `S3_REGION=auto`. Set `STORAGE_PUBLIC_BASE_URL` to a CDN/custom domain if optimized assets are publicly readable; otherwise the app issues signed GET URLs.

Direct browser uploads require bucket CORS. Restrict the origin to the catalog application in production:

```json
[
  {
    "AllowedOrigins": ["https://catalog.rashikapoorofficial.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Run at least one `npm run worker` process alongside the web application. MongoDB job leasing prevents multiple workers from processing the same catalog concurrently and retries failed jobs with backoff.

## Security and operations

- All admin APIs require an HTTP-only signed staff session and an `admin` or `staff` role.
- Upload keys are UUID-based and never use user filenames. Completion verifies size, MIME type, expected key, and file magic bytes.
- Unpublished catalogs are never returned by public APIs or routes.
- Original PDFs download through five-minute signed URLs.
- Set a 32+ character `AUTH_SECRET`, rotate object-storage credentials, use TLS, restrict storage CORS, and place the app behind a rate-limiting proxy/WAF in production.
- Configure object-storage lifecycle rules for abandoned upload keys and MongoDB backups. Processed assets are immutable and CDN-cacheable.

## API surface

The requested endpoints are implemented under `/api/catalogs`, including CRUD, upload initiation/completion, publish/unpublish, public lookup, secure download, processing retry, duplication, and view events. Admin routes return `401` without a staff session; public lookup only returns `published` records.
