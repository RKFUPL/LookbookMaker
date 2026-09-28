export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configureMongoDns } = await import("@/lib/mongodb-dns");
  configureMongoDns();
}
