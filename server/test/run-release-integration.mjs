// Launch and test within one local network namespace. No external services.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--help")) {
  console.log("node server/test/run-release-integration.mjs [--production]\nRuns local release protocols with a loopback server and synthetic credentials.");
  process.exit(0);
}
if (process.argv.slice(2).some(arg => arg !== "--production")) throw new Error("Unknown release test option");

const production = process.argv.includes("--production");
const port = production ? 8087 : 8086;
const origin = production ? "https://adversarial.example.invalid" : `http://127.0.0.1:${port}`;
const root = fileURLToPath(new URL("../..", import.meta.url));
const env = {
  ...process.env, HOST: "127.0.0.1", PORT: String(port),
  NODE_ENV: production ? "production" : "development", PUBLIC_ORIGIN: origin,
  SESSION_SECRET: "release-local-secret-0123456789-abcdef",
  ANALYTICS_SECRET: "release-local-analytics-secret-0123456789-abcdef",
  URL: `ws://127.0.0.1:${port}/ws`, ORIGIN: origin, HTTP_BASE: `http://127.0.0.1:${port}`,
  ANALYTICS: "off", ANALYTICS_BACKEND: "off",
};
mkdirSync(resolve(root, "test-results"), { recursive: true });
const log = createWriteStream(process.env.RELEASE_SERVER_LOG ?? resolve(root, "test-results/release-integration-server.log"));
const server = spawn(process.execPath, ["server/dist/server/src/index.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(log); server.stderr.pipe(log);
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(`Local server exited ${server.exitCode}`);
    try { ready = (await fetch(`${env.HTTP_BASE}/readyz`)).ok; } catch { /* bootstrap */ }
    if (ready) break;
    await sleep(100);
  }
  if (!ready) throw new Error("Local server readiness timeout");
  const tests = production ? ["integration-multigroup-adversarial.mjs"] : ["integration.mjs", "integration-individual.mjs", "integration-transport.mjs", "integration-drain.mjs"];
  for (const test of tests) {
    console.log(`Executing ${test} (${production ? "production security" : "development protocol"})`);
    const child = spawn(process.execPath, [`server/test/${test}`], { cwd: root, env, stdio: "inherit" });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    if (code !== 0) throw new Error(`${test} exited ${code}`);
  }
} finally {
  server.kill("SIGTERM");
  await Promise.race([new Promise(r => server.once("exit", r)), sleep(12000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
  log.end();
}
