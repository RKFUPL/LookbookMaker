import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_REDIRECTS = 5;

export class PdfDownloadError extends Error {
  readonly failureCode = "download_failed" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PdfDownloadError";
  }
}

function blockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0)
    || a >= 224;
}

function blockedAddress(address: string) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(value) === 4) return blockedIpv4(value);
  if (isIP(value) === 6) {
    return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd")
      || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")
      || value.startsWith("::ffff:192.168.") || value.startsWith("::ffff:10.") || value.startsWith("::ffff:127.");
  }
  return false;
}

export async function assertSafeRemoteUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("The PDF source must use HTTPS.");
  if (parsed.username || parsed.password) throw new Error("The PDF source URL cannot contain credentials.");
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || blockedAddress(hostname)) {
    throw new Error("The PDF source host is not allowed.");
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => blockedAddress(entry.address))) throw new Error("The PDF source host is not allowed.");
  return parsed.toString();
}

export async function downloadRemotePdf(sourceUrl: string, destination: string, maxBytes: number) {
  try {
    let currentUrl = await assertSafeRemoteUrl(sourceUrl);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const response = await fetch(currentUrl, {
        redirect: "manual",
        headers: { Accept: "application/pdf, application/octet-stream;q=0.9" },
        signal: AbortSignal.timeout(120_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("The PDF source returned an invalid redirect.");
        if (redirect === MAX_REDIRECTS) throw new Error("The PDF source redirected too many times.");
        currentUrl = await assertSafeRemoteUrl(new URL(location, currentUrl).toString());
        continue;
      }
      if (!response.ok) throw new Error(`The PDF source returned HTTP ${response.status}.`);

      const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      const allowedTypes = new Set(["application/pdf", "application/x-pdf", "application/octet-stream", "binary/octet-stream"]);
      if (!allowedTypes.has(contentType)) throw new Error("The PDF source did not return a PDF response.");

      const lengthHeader = response.headers.get("content-length");
      const announcedSize = lengthHeader === null ? null : Number(lengthHeader);
      if (announcedSize !== null && (!Number.isSafeInteger(announcedSize) || announcedSize <= 0)) {
        throw new Error("The PDF source returned an empty or invalid file size.");
      }
      if (announcedSize !== null && announcedSize > maxBytes) {
        throw new Error(`The PDF exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
      }
      if (!response.body) throw new Error("The PDF source returned an empty response.");

      let received = 0;
      const sizeLimiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          if (received > maxBytes) {
            callback(new Error(`The PDF exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`));
          } else {
            callback(null, chunk);
          }
        },
      });
      await pipeline(Readable.fromWeb(response.body as never), sizeLimiter, createWriteStream(destination, { flags: "wx" }));

      const details = await stat(destination);
      if (!details.size) throw new Error("The PDF source returned an empty file.");
      const handle = await open(destination, "r");
      const header = Buffer.alloc(5);
      try {
        await handle.read(header, 0, header.length, 0);
      } finally {
        await handle.close();
      }
      if (header.toString("ascii") !== "%PDF-") throw new Error("The downloaded file is not a valid PDF.");
      return { size: details.size, contentType: "application/pdf", finalUrl: currentUrl };
    }
    throw new Error("The PDF source redirected too many times.");
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    if (error instanceof PdfDownloadError) throw error;
    throw new PdfDownloadError(error instanceof Error ? error.message : "Unable to download the PDF source.", { cause: error });
  }
}
