import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transforms) {
  let text = await readFile(path, "utf8");
  for (const [from, to] of transforms) {
    if (!text.includes(from)) throw new Error(`Missing transform anchor in ${path}: ${from.slice(0, 100)}`);
    text = text.replace(from, to);
  }
  await writeFile(path, text);
}

await edit("shared/types.ts", [
  [
    '  | "UNAUTHORIZED"\n  | "INTERNAL";',
    '  | "UNAUTHORIZED"\n  | "SERVER_RESTARTING"\n  | "INTERNAL";'
  ],
  [
    '  | { t: "KICKED" }\n  | { t: "PONG"; sampleId?: string; serverMs?: number };',
    '  | { t: "KICKED" }\n  | { t: "SERVER_RESTARTING"; deadlineMs: number }\n  | { t: "PONG"; sampleId?: string; serverMs?: number };'
  ],
]);

await edit("client/src/i18n/errors.ts", [[
  '  UNAUTHORIZED: "حدّث الصفحة وجرّب مرة ثانية",\n  INTERNAL:',
  '  UNAUTHORIZED: "حدّث الصفحة وجرّب مرة ثانية",\n  SERVER_RESTARTING: "الخادم يعاد تشغيله الآن؛ انتظر شوي قبل تبدأ لعبة جديدة",\n  INTERNAL:'
]]);

await edit("client/src/net/socket.ts", [[
  '    case "KICKED":\n      set({ view: null, notice: "المضيف طلعك من الغرفة" });\n      break;\n    case "PONG":',
  '    case "KICKED":\n      set({ view: null, notice: "المضيف طلعك من الغرفة" });\n      break;\n    case "SERVER_RESTARTING": {\n      const deadline = new Date(message.deadlineMs).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" });\n      feedback(`الخادم بيتعاد تشغيله. ما راح تبدأ لعبة جديدة، والاتصال الحالي بيتقفل تقريبًا ${deadline}.`);\n      break;\n    }\n    case "PONG":'
]]);

await edit("server/src/config.ts", [[
  '    authTimeoutMs: positiveInteger(env.AUTH_TIMEOUT_MS, 8_000),\n    emptyLobbyExpiryMs:',
  '    authTimeoutMs: positiveInteger(env.AUTH_TIMEOUT_MS, 8_000),\n    drainTimeoutMs: positiveInteger(env.DRAIN_TIMEOUT_MS, 10_000),\n    emptyLobbyExpiryMs:'
]]);

await edit("server/src/game/roomManager.ts", [
  [
    '  private readonly requestsByUid = new Map<string, Map<string, CachedRequest>>();\n  private readonly deps: Deps;',
    '  private readonly requestsByUid = new Map<string, Map<string, CachedRequest>>();\n  private draining = false;\n  private readonly deps: Deps;'
  ],
  [
    '  private dispatch(conn: Connection, message: ClientMessage): void {\n    const uid = conn.uid;\n    if (!uid) throw new GameError("UNAUTHORIZED");\n    switch (message.t) {',
    '  private dispatch(conn: Connection, message: ClientMessage): void {\n    const uid = conn.uid;\n    if (!uid) throw new GameError("UNAUTHORIZED");\n    if (this.draining && (message.t === "CREATE_ROOM" || message.t === "JOIN_ROOM" || message.t === "START_GAME" || message.t === "REMATCH")) {\n      throw new GameError("SERVER_RESTARTING", "server is draining");\n    }\n    switch (message.t) {'
  ],
  [
    '  dispose(): void {\n    clearInterval(this.gcTimer);',
    '  setDraining(draining = true): void { this.draining = draining; }\n  isDrainingForTests(): boolean { return this.draining; }\n\n  dispose(): void {\n    clearInterval(this.gcTimer);'
  ],
]);

await edit("server/src/game/engine.ts", [
  [
    'import { IMITATION_PROMPTS, type ImitationPrompt } from "./imitationPrompts.data.js";\nimport { pickPair }',
    'import { IMITATION_PROMPTS, type ImitationPrompt } from "./imitationPrompts.data.js";\nimport type { PromptFamily } from "./promptMetadata.js";\nimport { pickPair }'
  ],
  [
`function pickPrompt(room: RoomState, mode: GameMode, deps: EngineDeps): ImitationPrompt {
  const pool = IMITATION_PROMPTS.filter((prompt) => prompt.mode === mode);
  let candidates = pool.filter((prompt) => !room.usedPromptIds.has(prompt.id));

  if (!candidates.length) {
    // Prompt history is game-scoped. Only this mode is reset, and only after
    // every prompt in its bank has been consumed.
    for (const prompt of pool) room.usedPromptIds.delete(prompt.id);
    candidates = pool;
  }

  if (!candidates.length) throw new GameError("INTERNAL", \`no prompts for \${mode}\`);

  const index = Math.min(Math.floor(deps.rng() * candidates.length), candidates.length - 1);
  const prompt = candidates[index];
  room.usedPromptIds.add(prompt.id);
  return prompt;
}`,
`export function choosePromptCandidate(
  candidates: ImitationPrompt[],
  previousFamily: PromptFamily | undefined,
  rng: () => number,
): ImitationPrompt {
  if (!candidates.length) throw new GameError("INTERNAL", "no prompt candidates");
  const spaced = previousFamily ? candidates.filter((prompt) => prompt.family !== previousFamily) : candidates;
  const selectionPool = spaced.length ? spaced : candidates;
  const index = Math.min(Math.floor(rng() * selectionPool.length), selectionPool.length - 1);
  return selectionPool[index]!;
}

function pickPrompt(room: RoomState, mode: GameMode, deps: EngineDeps): ImitationPrompt {
  const pool = IMITATION_PROMPTS.filter((prompt) => prompt.mode === mode);
  let candidates = pool.filter((prompt) => !room.usedPromptIds.has(prompt.id));

  if (!candidates.length) {
    // Prompt history is game-scoped. Only this mode is reset, and only after
    // every prompt in its bank has been consumed.
    for (const prompt of pool) room.usedPromptIds.delete(prompt.id);
    candidates = pool;
  }

  if (!candidates.length) throw new GameError("INTERNAL", \`no prompts for \${mode}\`);

  const previousFamily = room.round?.promptId
    ? IMITATION_PROMPTS.find((prompt) => prompt.id === room.round?.promptId)?.family
    : undefined;
  // Topic spacing is best-effort only. It never bypasses exact game-scoped
  // no-repeat history; when only one family remains, selection falls back.
  const prompt = choosePromptCandidate(candidates, previousFamily, deps.rng);
  room.usedPromptIds.add(prompt.id);
  return prompt;
}`
  ],
]);

await edit("server/src/index.ts", [
  [
    'import { dirname, join, resolve } from "node:path";',
    'import { existsSync } from "node:fs";\nimport { dirname, join, resolve } from "node:path";'
  ],
  [
    'const sourceDir = dirname(fileURLToPath(import.meta.url));\nconst clientDist = join(sourceDir, "..", "..", "client", "dist");',
    'const sourceDir = dirname(fileURLToPath(import.meta.url));\nconst clientDistCandidates = [\n  join(sourceDir, "..", "..", "client", "dist"),\n  join(sourceDir, "..", "..", "..", "..", "client", "dist"),\n];\nconst clientDist = clientDistCandidates.find((candidate) => existsSync(candidate)) ?? clientDistCandidates[0]!;'
  ],
  [
    '  const violations = new WeakMap<Connection, number>();\n\n  app.disable',
    '  const violations = new WeakMap<Connection, number>();\n  let draining = false;\n  let drainDeadlineMs: number | undefined;\n  let drainTimer: NodeJS.Timeout | undefined;\n\n  app.disable'
  ],
  [
    '  app.get("/healthz", (_req, res) => {\n    res.setHeader("Cache-Control", "no-store");\n    res.json({ ok: true });\n  });\n\n  app.get("/api/session", (req, res) => {',
    '  app.get("/healthz", (_req, res) => {\n    res.setHeader("Cache-Control", "no-store");\n    res.json({ ok: true });\n  });\n\n  app.get("/readyz", (_req, res) => {\n    res.setHeader("Cache-Control", "no-store");\n    res.status(draining ? 503 : 200).json({ ok: !draining, draining, ...(drainDeadlineMs ? { deadlineMs: drainDeadlineMs } : {}) });\n  });\n\n  app.get("/api/session", (req, res) => {\n    if (draining) {\n      res.setHeader("Cache-Control", "no-store");\n      res.status(503).json({ ok: false, code: "SERVER_RESTARTING", ...(drainDeadlineMs ? { deadlineMs: drainDeadlineMs } : {}) });\n      return;\n    }'
  ],
  [
    '    if (pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");\n\n    const ip = clientIp',
    '    if (pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");\n    if (draining) return rejectUpgrade(socket, 503, "Service Restarting");\n\n    const ip = clientIp'
  ],
  [
    '  let disposed = false;\n  const dispose = () => {',
    '  const finishDrain = () => {\n    if (!draining) return;\n    if (drainTimer) { clearTimeout(drainTimer); drainTimer = undefined; }\n    for (const ws of wss.clients) {\n      if (ws.readyState === 0 || ws.readyState === 1) ws.close(1012, "service restarting");\n    }\n    server.close();\n    const force = setTimeout(() => { for (const ws of wss.clients) ws.terminate(); }, 1_000);\n    force.unref?.();\n  };\n\n  const beginDrain = (graceMs = config.drainTimeoutMs): number => {\n    if (draining && drainDeadlineMs) return drainDeadlineMs;\n    draining = true;\n    drainDeadlineMs = Date.now() + Math.max(1, graceMs);\n    manager.setDraining(true);\n    for (const ws of wss.clients) {\n      const conn = connections.get(ws);\n      if (conn) conn.send({ t: "SERVER_RESTARTING", deadlineMs: drainDeadlineMs });\n    }\n    drainTimer = setTimeout(finishDrain, Math.max(1, graceMs));\n    return drainDeadlineMs;\n  };\n\n  let disposed = false;\n  const dispose = () => {'
  ],
  [
    '    clearInterval(heartbeat);\n    abuse.dispose();',
    '    clearInterval(heartbeat);\n    if (drainTimer) clearTimeout(drainTimer);\n    abuse.dispose();'
  ],
  [
    '  server.on("close", dispose);\n  return { app, server, wss, manager, dispose, capacity };',
    '  server.on("close", dispose);\n  return { app, server, wss, manager, dispose, capacity, beginDrain, finishDrain, isReady: () => !draining };'
  ],
  [
    '  runtime.server.listen(config.port, config.host, () => {\n    console.log(`«خلك طبيعي» listening on port ${config.port} (${totalPairs()} question pairs)`);\n  });\n}',
    '  runtime.server.listen(config.port, config.host, () => {\n    console.log(`«خلك طبيعي» listening on port ${config.port} (${totalPairs()} legacy question pairs)`);\n  });\n  let signalHandled = false;\n  const shutdown = (signal: NodeJS.Signals) => {\n    if (signalHandled) return;\n    signalHandled = true;\n    const deadlineMs = runtime.beginDrain(config.drainTimeoutMs);\n    console.log(`${signal}: draining until ${new Date(deadlineMs).toISOString()}`);\n  };\n  process.on("SIGTERM", () => shutdown("SIGTERM"));\n  process.on("SIGINT", () => shutdown("SIGINT"));\n}'
  ],
]);

console.log("Stage D source transforms applied");
