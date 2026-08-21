import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const port = process.env.PORT || "10000";
const environment = { ...process.env, PORT: port };
const children: ChildProcess[] = [];
let stopping = false;
let exitCode = 0;

function start(args: string[]) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  children.push(child);
  return child;
}

start([resolve("node_modules/next/dist/bin/next"), "start", "-H", "0.0.0.0", "-p", port]);
start(["--import", "tsx", resolve("scripts/catalog-worker.ts")]);

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

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

for (const child of children) {
  child.once("error", (error) => {
    console.error("Render child process error:", error);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`Render child process exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "none"}).`);
      stop(code && code > 0 ? code : 1);
    } else if (children.every((entry) => entry.exitCode !== null)) {
      process.exit(exitCode);
    }
  });
}

console.log(`RK Render service started on 0.0.0.0:${port} with one catalog worker.`);
