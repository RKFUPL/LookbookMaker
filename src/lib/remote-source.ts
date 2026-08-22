import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function blockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224;
}

function blockedAddress(address: string) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(value) === 4) return blockedIpv4(value);
  if (isIP(value) === 6) return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
  return false;
}

/** Validate an HTTPS source before saving it. The browser performs the PDF request. */
export async function assertSafeRemoteUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("The PDF source must use HTTPS.");
  if (parsed.username || parsed.password) throw new Error("The PDF source URL cannot contain credentials.");
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || blockedAddress(hostname)) throw new Error("The PDF source host is not allowed.");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => blockedAddress(entry.address))) throw new Error("The PDF source host is not allowed.");
  return parsed.toString();
}
