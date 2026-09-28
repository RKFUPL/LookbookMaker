import dns from "node:dns";

const LOCAL_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];
let lastDiagnosticKey = "";

function isLoopbackServer(server: string) {
  return server === "127.0.0.1" || server === "::1";
}

/**
 * Node's c-ares resolver can be pointed at a local DNS proxy which refuses
 * Atlas SRV queries on some Windows installations. Keep production on the
 * platform resolver, but make local development recoverable and configurable.
 */
export function configureMongoDns() {
  const runtime = process.env.NEXT_RUNTIME || "unknown";
  const mode = process.env.NODE_ENV || "unknown";
  const before = dns.getServers();
  if (mode === "production") {
    logDiagnostic(`${runtime}|${mode}|production-skip`, before, before, "production-skip");
    return;
  }

  const configured = process.env.MONGODB_DNS_SERVERS
    ?.split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  const current = dns.getServers();
  const source = configured?.length ? "MONGODB_DNS_SERVERS" : current.every(isLoopbackServer) ? "loopback-fallback" : "system-resolver";
  const servers = configured?.length ? configured : current.every(isLoopbackServer) ? LOCAL_DNS_SERVERS : undefined;

  if (servers?.length && before.join(",") !== servers.join(",")) dns.setServers(servers);
  if (servers?.length && dns.promises.getServers().join(",") !== servers.join(",")) dns.promises.setServers(servers);
  logDiagnostic(`${runtime}|${mode}|${source}|${(servers || before).join(",")}`, before, dns.getServers(), source);
}

function logDiagnostic(key: string, before: string[], after: string[], source: string) {
  if (key === lastDiagnosticKey) return;
  lastDiagnosticKey = key;
  console.info(`[mongodb-dns] runtime=${process.env.NEXT_RUNTIME || "unknown"} mode=${process.env.NODE_ENV || "unknown"} source=${source} before=${before.join(",") || "none"} after=${after.join(",") || "none"}`);
}
