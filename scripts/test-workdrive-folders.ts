import assert from "node:assert/strict";
import { ensureCollectionFolder } from "../src/lib/workdrive";

type WorkDriveConfig = Parameters<typeof ensureCollectionFolder>[2];
const config = {
  ZOHO_WORKDRIVE_FOLDER_ID: "root-id",
  ZOHO_WORKDRIVE_API_BASE_URL: "https://api.test",
} as WorkDriveConfig;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function run(name: string, queue: Array<Response | (() => Response)>, expected: string) {
  const original = global.fetch;
  global.fetch = async () => {
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request in ${name}`);
    return typeof next === "function" ? next() : next;
  };
  try {
    const result = await ensureCollectionFolder("Collection", "token-for-test", config);
    assert.equal(result.collectionFolderId, expected, name);
  } finally {
    global.fetch = original;
  }
}

async function main() {
  await run("object create response", [response({ data: [] }), response({ data: { id: "object-folder", attributes: { name: "Collection", type: "folder" } } })], "object-folder");
  await run("array create response", [response({ data: [] }), response({ data: [{ id: "array-folder", attributes: { name: "Collection", type: "folder" } }] })], "array-folder");
  await run("existing folder reuse", [response({ data: [{ id: "existing-folder", attributes: { name: " collection ", type: "folder" } }] })], "existing-folder");
  await assert.rejects(() => run("provider error", [response({ data: [] }), response({ code: "PERMISSION_DENIED", message: "Folder creation is not allowed" }, 403), response({ data: [] })], "unused"), /WorkDrive folder operation failed \(HTTP 403\): Folder creation is not allowed \[PERMISSION_DENIED\]/);
  await run("concurrent creation retry", [response({ data: [] }), response({ code: "CONFLICT", message: "Already exists" }, 409), response({ data: [{ id: "concurrent-folder", attributes: { name: "Collection", type: "folder" } }] })], "concurrent-folder");
  console.log("WorkDrive folder tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
