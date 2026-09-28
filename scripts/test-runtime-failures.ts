import assert from "node:assert/strict";
import { withTimeout } from "../src/lib/async-timeout";
import { connectSingleFlight, type AsyncConnectionCache } from "../src/lib/connection-cache";
import { pdfViewerErrorMessage } from "../src/lib/pdf-viewer-error";
import { validateUpload } from "../src/lib/pdf-upload";
import { catalogCreateSchema } from "../src/lib/validation";
import { canAccessCatalogPdf, catalogHasPdf, catalogPdfProxyPath, catalogPublicPath } from "../src/lib/catalog-availability";
import { chooseWorkDrivePdfName, sanitizeWorkDriveName } from "../src/lib/workdrive";
import { workDriveCatalogMetadata } from "../src/lib/workdrive-catalog";

async function main() {
  await assert.rejects(withTimeout(new Promise(() => undefined), 5, "metadata timed out"), /metadata timed out/);
  assert.match(pdfViewerErrorMessage(new Error("PDF metadata request timed out.")), /took too long/);
  assert.match(pdfViewerErrorMessage(new Error("Unexpected server response (502)")), /direct downloadable PDF link/);
  await validateUpload(new File(["%PDF-1.7\nbody"], "sample.pdf", { type: "application/pdf" }), 1000);
  assert.ok(catalogCreateSchema.parse({ title: "Uploaded catalog", collection: "Summer" }));
  assert.equal(catalogHasPdf({ sourceType: "workdrive", workdriveFileId: "workdrive-file", sourcePdfUrl: "" }), true);
  assert.equal(catalogHasPdf({ sourceType: "external_url", workdriveFileId: "", sourcePdfUrl: "" }), false);
  assert.equal(canAccessCatalogPdf("published", false), true, "published PDFs must be publicly readable");
  assert.equal(canAccessCatalogPdf("draft", false), false, "draft PDFs must reject anonymous readers");
  assert.equal(canAccessCatalogPdf("draft", true), true, "staff may preview draft PDFs");
  assert.equal(catalogPdfProxyPath("catalog id", true), "/api/catalogs/catalog%20id/pdf?download=1");
  assert.equal(catalogPublicPath("sandook"), "/catalog/sandook");
  assert.equal(catalogPublicPath("sandook").includes("localhost:3001"), false);
  const uploadTime = new Date("2026-09-28T00:00:00.000Z");
  assert.deepEqual(
    workDriveCatalogMetadata({ id: "resource-id", name: "Sandook.pdf", fileType: "pdf", stableLink: "https://www.zohoapis.in/workdrive/file/resource-id", folderId: "collection-folder", rootFolderId: "root-folder", size: 1234 }, "original.pdf", "staff-id", uploadTime),
    { sourceType: "workdrive", sourcePdfUrl: "", workdriveFileId: "resource-id", workdriveFileName: "Sandook.pdf", workdriveFileType: "pdf", workdriveLink: "https://www.zohoapis.in/workdrive/file/resource-id", workdriveFolderId: "collection-folder", workdriveRootFolderId: "root-folder", sourceSize: 1234, originalFilename: "original.pdf", uploadedAt: uploadTime, uploadedBy: "staff-id" },
  );
  await assert.rejects(validateUpload(new File(["<html>"], "sample.pdf", { type: "application/pdf" }), 1000), /valid PDF/);
  await assert.rejects(validateUpload(new File(["%PDF-"], "sample.txt", { type: "text/plain" }), 1000), /Only PDF/);
  assert.equal(sanitizeWorkDriveName("  Summer / 2026  "), "Summer-2026");
  assert.equal(chooseWorkDrivePdfName("Anamika", []), "Anamika.pdf");
  assert.match(chooseWorkDrivePdfName("Anamika", ["anamika.pdf"]), /^Anamika-\d+\.pdf$/);

  const cache: AsyncConnectionCache<{ ready: boolean }> = { connection: null, promise: null };
  let attempts = 0;
  const failing = () => {
    attempts += 1;
    return Promise.reject(new Error("temporary DNS failure"));
  };
  await assert.rejects(Promise.all([connectSingleFlight(cache, failing), connectSingleFlight(cache, failing)]), /temporary DNS failure/);
  assert.equal(attempts, 1, "concurrent requests must share one connection attempt");
  assert.equal(cache.promise, null, "a failed connection promise must be cleared");

  const connection = await connectSingleFlight(cache, async () => {
    attempts += 1;
    return { ready: true };
  });
  assert.deepEqual(connection, { ready: true });
  assert.equal(attempts, 2, "the next request must be allowed to retry");
  console.log("Runtime failure tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
