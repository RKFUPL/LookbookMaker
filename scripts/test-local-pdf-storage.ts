import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "lookbook-storage-test-"));
  process.env.LOOKBOOK_STORAGE_DIR = root;
  const { copyLocalPdf, localPdfResponse, persistAfterLocalPdfWrite, removeLocalPdf, resolveLocalPdfPath, storeLocalPdf } = await import("../src/lib/local-pdf-storage");
  try {
    const source = "%PDF-1.7\nlocal-pdf-body";
    const stored = await storeLocalPdf(new File([source], "../unsafe name.pdf", { type: "application/pdf" }));
    assert.equal(stored.storageProvider, "local");
    assert.equal(stored.sourceType, "local");
    assert.match(stored.storageKey, /^lookbooks\/\d{4}\/\d{2}\/[0-9a-f-]+\.pdf$/);
    assert.equal(await readFile(resolveLocalPdfPath(stored.storageKey), "utf8"), source);

    const copied = await copyLocalPdf(stored.storageKey);
    assert.notEqual(copied.storageKey, stored.storageKey);
    assert.equal(await readFile(resolveLocalPdfPath(copied.storageKey), "utf8"), source);

    const failed = await storeLocalPdf(new File([source], "failed.pdf", { type: "application/pdf" }));
    await assert.rejects(persistAfterLocalPdfWrite(failed.storageKey, async () => { throw new Error("database unavailable"); }), (error: unknown) => {
      return error instanceof Error && "code" in error && error.code === "CATALOG_SAVE_FAILED";
    });
    await assert.rejects(readFile(resolveLocalPdfPath(failed.storageKey)), /ENOENT/);

    const full = await localPdfResponse(stored.storageKey, new Request("http://localhost/pdf"));
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "application/pdf");
    assert.equal(await full.text(), source);

    const ranged = await localPdfResponse(stored.storageKey, new Request("http://localhost/pdf", { headers: { Range: "bytes=0-4" } }));
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), `bytes 0-4/${Buffer.byteLength(source)}`);
    assert.equal(await ranged.text(), "%PDF-");

    const head = await localPdfResponse(stored.storageKey, new Request("http://localhost/pdf", { method: "HEAD" }));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    assert.throws(() => resolveLocalPdfPath("../secret.pdf"), /invalid local PDF reference/);
    await assert.rejects(localPdfResponse("lookbooks/2026/09/missing.pdf", new Request("http://localhost/pdf")), /not found/);

    const invalidKey = `${path.posix.dirname(stored.storageKey)}/invalid.pdf`;
    const invalidPath = resolveLocalPdfPath(invalidKey);
    await mkdir(path.dirname(invalidPath), { recursive: true });
    await writeFile(invalidPath, "<html>not pdf</html>");
    await assert.rejects(localPdfResponse(invalidKey, new Request("http://localhost/pdf")), /not a valid PDF/);

    await removeLocalPdf(stored.storageKey);
    await removeLocalPdf(copied.storageKey);
    await assert.rejects(localPdfResponse(stored.storageKey, new Request("http://localhost/pdf")), /not found/);

    const compose = await readFile(path.join(process.cwd(), "docker-compose.yml"), "utf8");
    assert.match(compose, /LOOKBOOK_STORAGE_DIR:\s*\/data\/lookbooks/);
    assert.match(compose, /lookbook-maker-storage\/pdfs}:\/data\/lookbooks/);
    console.log("Local PDF storage tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
