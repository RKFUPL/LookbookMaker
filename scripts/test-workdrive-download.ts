import assert from "node:assert/strict";

process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/workdrive-test";
process.env.AUTH_SECRET = "test-only-secret-at-least-thirty-two-characters";
process.env.ZOHO_WORKDRIVE_CLIENT_ID = "test-client";
process.env.ZOHO_WORKDRIVE_CLIENT_SECRET = "test-secret";
process.env.ZOHO_WORKDRIVE_REFRESH_TOKEN = "test-refresh";
process.env.ZOHO_WORKDRIVE_FOLDER_ID = "test-folder";
process.env.ZOHO_OAUTH_TOKEN_URL = "https://accounts.example.test/oauth/token";
process.env.ZOHO_WORKDRIVE_API_BASE_URL = "https://www.zohoapis.in";
process.env.ZOHO_WORKDRIVE_DOWNLOAD_BASE_URL = "https://download.zoho.in";

type DownloadFactory = (init: RequestInit | undefined) => Response;

async function main() {
  const { downloadWorkDrivePdf } = await import("../src/lib/workdrive");
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let downloads: DownloadFactory[] = [];
  let nextToken: Response | null = null;
  const warnings: string[] = [];

  console.warn = (...values: unknown[]) => warnings.push(values.map(String).join(" "));
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === process.env.ZOHO_OAUTH_TOKEN_URL) {
      const response = nextToken || Response.json({ access_token: "test-access-token" });
      nextToken = null;
      return response;
    }
    if (url === "https://www.zohoapis.in/workdrive/api/v1/files/file-id") {
      return Response.json({ data: { id: "file-id", type: "files", attributes: { type: "pdf", download_url: "https://download.zoho.in/v1/workdrive/download/file-id", capabilities: { can_read: true, can_download: true } } } });
    }
    assert.ok(url === "https://download.zoho.in/v1/workdrive/download/file-id" || url.startsWith("https://download-accl.zoho.in/"));
    assert.ok(downloads.length, "a download response must be configured");
    const factory = downloads.shift()!;
    return factory(init);
  };

  try {
    downloads = [() => new Response("%PDF-1.7\nbody", { status: 200, headers: { "content-type": "application/pdf" } })];
    const pdf = await downloadWorkDrivePdf("file-id", new Request("http://localhost/pdf"));
    assert.equal(pdf.status, 200);
    assert.equal(await pdf.text(), "%PDF-1.7\nbody");

    downloads = [(init) => {
      assert.equal(new Headers(init?.headers).get("range"), "bytes=0-1023");
      return new Response("%PDF-partial", { status: 206, headers: { "content-range": "bytes 0-11/100" } });
    }];
    const partial = await downloadWorkDrivePdf("file-id", new Request("http://localhost/pdf", { headers: { Range: "bytes=0-1023" } }));
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 0-11/100");

    downloads = [
      () => new Response(null, { status: 302, headers: { location: "https://download-accl.zoho.in/temporary/file?signature=private" } }),
      (init) => {
        assert.equal(new Headers(init?.headers).get("authorization"), "Zoho-oauthtoken test-access-token");
        return new Response("%PDF-redirected", { status: 200, headers: { "content-type": "application/pdf" } });
      },
    ];
    const redirected = await downloadWorkDrivePdf("file-id", new Request("http://localhost/pdf"));
    assert.equal(redirected.status, 200);
    assert.equal(await redirected.text(), "%PDF-redirected");

    const failures = [
      { status: 401, body: { error_code: "INVALID_OAUTH", error: "Invalid OAuth token" } },
      { status: 401, body: { code: "F7004", title: "Invalid OAuth scope" } },
      { status: 403, body: { code: "ACCESS_DENIED", message: "File access denied" } },
      { status: 404, body: { id: "FILE_NOT_FOUND", detail: "File not found" } },
    ];
    for (const failure of failures) {
      downloads = [() => Response.json(failure.body, { status: failure.status })];
      const response = await downloadWorkDrivePdf("file-id", new Request("http://localhost/pdf"));
      const body = await response.json() as { providerCode: string; providerMessage: string };
      assert.equal(response.status, failure.status);
      assert.ok(body.providerCode);
      assert.ok(body.providerMessage);
    }
    assert.ok(warnings.some((line) => line.includes("status=401") && line.includes("provider_code=F7004") && line.includes("Invalid OAuth scope")));
    assert.ok(warnings.every((line) => !line.includes("test-access-token") && !line.includes("test-refresh") && !line.includes("test-secret")));

    nextToken = Response.json({ error: "invalid_grant" }, { status: 401 });
    await assert.rejects(downloadWorkDrivePdf("file-id", new Request("http://localhost/pdf")), (error: unknown) => {
      return error instanceof Error && "code" in error && error.code === "WORKDRIVE_REFRESH_TOKEN_INVALID";
    });
    downloads = [() => new Response("%PDF-after-refresh", { status: 200, headers: { "content-type": "application/pdf" } })];
    assert.equal((await downloadWorkDrivePdf("file-id", new Request("http://localhost/pdf"))).status, 200);
    console.log("WorkDrive download tests passed");
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
