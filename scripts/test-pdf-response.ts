import assert from "node:assert/strict";
import { preparePdfResponse } from "../src/lib/pdf-response";

async function main() {
  const sourceBytes = "%PDF-1.7\nbody";
  const pdf = await preparePdfResponse(new Response(sourceBytes, { headers: { "content-type": "application/pdf" } }));
  assert.equal(pdf.valid, true);
  assert.equal(await new Response(pdf.body).text(), sourceBytes, "signature inspection must preserve every byte");

  assert.equal((await preparePdfResponse(new Response("<html>login</html>", { headers: { "content-type": "text/html" } }))).valid, false);
  assert.equal((await preparePdfResponse(new Response(JSON.stringify({ error: "denied" }), { headers: { "content-type": "application/json" } }))).valid, false);
  assert.equal((await preparePdfResponse(new Response("partial", { status: 206, headers: { "content-range": "bytes 100-200/1000" } }))).valid, true);
  console.log("PDF response tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
