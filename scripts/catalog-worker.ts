import { workOnce } from "../src/lib/catalog-worker";

let stopping = false;
const pollMs = Math.max(500, Number(process.env.WORKER_POLL_MS || 2500));

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  console.log(`RK catalog worker started (polling every ${pollMs}ms).`);
  while (!stopping) {
    try {
      const worked = await workOnce();
      if (!worked) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } catch (error) {
      console.error("Worker loop error:", error);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  console.log("RK catalog worker stopped.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
