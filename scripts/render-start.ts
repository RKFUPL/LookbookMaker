import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { getConfig } from "../src/lib/config";

const port = process.env.PORT || "10000";
const environment = { ...process.env, PORT: port };
const children: ChildProcess[] = [];
let stopping = false;
let exitCode = 0;

function start(args: string[]) {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env: environment, stdio: "inherit" });
  children.push(child);
  return child;
}

function stop(code: number) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  const forceStop = setTimeout(() => {
    for (const child of children) if (!child.killed) child.kill("SIGKILL");
    process.exit(exitCode);
  }, 30_000);
  forceStop.unref();
}

async function main() {
  getConfig();
  console.log("RK Render service: external PDF mode (MongoDB metadata only; no local asset storage). ");
  const server = start([resolve("node_modules/next/dist/bin/next"), "start", "-H", "0.0.0.0", "-p", port]);
  process.once("SIGINT", () => stop(0));
  process.once("SIGTERM", () => stop(0));
  server.once("error", (error) => { console.error("Render server error:", error); stop(1); });
  server.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`Render server exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "none"}).`);
      stop(code && code > 0 ? code : 1);
    } else process.exit(exitCode);
  });
  console.log(`RK Render service started on 0.0.0.0:${port}.`);
}

main().catch((error) => {
  console.error("Render startup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
