// Long-running stability soak against ONE production-mode server process.
// Replays the multi-group adversarial campaign (shipped timers, 3/6/10-player
// rooms, reconnects, invalid actions, rematches) until SOAK_MINUTES elapse and
// samples the server's RSS, open file descriptors and readiness every 30 s.
// Loopback only; synthetic secrets; analytics off. Linux (/proc) required.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const minutes = Number(process.env.SOAK_MINUTES ?? 120);
const port = Number(process.env.SOAK_PORT ?? 8090);
const origin = "https://soak.example.invalid";
const root = fileURLToPath(new URL("../..", import.meta.url));
const out = resolve(root, "test-results/soak");
mkdirSync(out, { recursive: true });
const env = {
  ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production", PUBLIC_ORIGIN: origin,
  SESSION_SECRET: "soak-local-secret-0123456789-abcdef-0123",
  ANALYTICS_SECRET: "soak-local-analytics-secret-0123456789-abcdef",
  URL: `ws://127.0.0.1:${port}/ws`, ORIGIN: origin, HTTP_BASE: `http://127.0.0.1:${port}`,
  ANALYTICS: "off", ANALYTICS_BACKEND: "off",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverLog = createWriteStream(resolve(out, "server.log"));
const samples = createWriteStream(resolve(out, "samples.jsonl"));
const server = spawn(process.execPath, ["server/dist/server/src/index.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(serverLog); server.stderr.pipe(serverLog);

function sample(label) {
  const status = readFileSync(`/proc/${server.pid}/status`, "utf8");
  const rssKiB = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? NaN);
  const fds = readdirSync(`/proc/${server.pid}/fd`).length;
  return { at: new Date().toISOString(), label, rssMiB: +(rssKiB / 1024).toFixed(1), openFds: fds };
}

let campaigns = 0; let failures = 0;
const started = Date.now();
try {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    try { ready = (await fetch(`${env.HTTP_BASE}/readyz`)).ok; } catch { /* booting */ }
    if (!ready) await sleep(100);
  }
  if (!ready) throw new Error("server not ready");
  samples.write(JSON.stringify(sample("start")) + "\n");
  const sampler = setInterval(async () => {
    let readyz = false;
    try { readyz = (await fetch(`${env.HTTP_BASE}/readyz`)).ok; } catch { /* reported below */ }
    samples.write(JSON.stringify({ ...sample("tick"), readyz, campaigns, failures }) + "\n");
  }, 30_000);
  while (Date.now() - started < minutes * 60_000) {
    const child = spawn(process.execPath, ["server/test/integration-multigroup-adversarial.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    child.stdout.on("data", (d) => { tail = (tail + d).slice(-2000); });
    child.stderr.on("data", (d) => { tail = (tail + d).slice(-2000); });
    const code = await new Promise((r) => child.once("exit", r));
    campaigns += 1;
    if (code !== 0) {
      failures += 1;
      samples.write(JSON.stringify({ at: new Date().toISOString(), label: "campaign-failed", campaign: campaigns, tail }) + "\n");
    }
    // Let per-IP admission windows (room creation, connections) roll over between campaigns.
    await sleep(Number(process.env.SOAK_GAP_MS ?? 20_000));
  }
  clearInterval(sampler);
  await sleep(5_000);
  samples.write(JSON.stringify({ ...sample("end"), campaigns, failures }) + "\n");
  console.log(JSON.stringify({ minutes, campaigns, failures }));
} finally {
  server.kill("SIGTERM");
  await Promise.race([new Promise((r) => server.once("exit", r)), sleep(12_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
  serverLog.end(); samples.end();
}
process.exitCode = failures === 0 ? 0 : 1;
