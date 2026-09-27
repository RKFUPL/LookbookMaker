import dns from "node:dns";

const LOCAL_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];

function isLoopbackServer(server: string) {
  return server === "127.0.0.1" || server === "::1";
}

/**
 * Node's c-ares resolver can be pointed at a local DNS proxy which refuses
 * Atlas SRV queries on some Windows installations. Keep production on the
 * platform resolver, but make local development recoverable and configurable.
 */
export function configureMongoDns() {
  if (process.env.NODE_ENV === "production") return;

  const configured = process.env.MONGODB_DNS_SERVERS
    ?.split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  const current = dns.getServers();
  const servers = configured?.length ? configured : current.every(isLoopbackServer) ? LOCAL_DNS_SERVERS : undefined;

  if (servers?.length) dns.setServers(servers);
}
