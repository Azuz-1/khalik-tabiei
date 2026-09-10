type ClientEvent =
  | "client_started"
  | "client_performance"
  | "client_vital"
  | "client_session_summary"
  | "client_error";

type TelemetryValue = string | number | boolean;
interface TelemetryItem { event: ClientEvent; props: Record<string, TelemetryValue> }

const queue: TelemetryItem[] = [];
const MAX_QUEUE = 60;
const BATCH_SIZE = 20;
const FLUSH_MS = 5_000;
let flushTimer: number | undefined;
let sending = false;
let errorEvents = 0;

function routeBucket(): string {
  if (/^\/join\//.test(location.pathname)) return "join";
  return location.pathname === "/" ? "home" : "other";
}

function clamp(value: number, max = 1_000_000): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

function enqueue(event: ClientEvent, props: Record<string, TelemetryValue>): void {
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ event, props });
  if (queue.length >= BATCH_SIZE) void flush();
  else scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    void flush();
  }, FLUSH_MS);
}

async function flush(keepalive = false): Promise<void> {
  if (sending || queue.length === 0) return;
  sending = true;
  const batch = queue.splice(0, BATCH_SIZE);
  try {
    const response = await fetch("/api/telemetry", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
    });
    // Authentication bootstrap can still be racing on the first page load.
    // Telemetry is best-effort and must never retry without bound.
    if (!response.ok && response.status >= 500 && queue.length < MAX_QUEUE - batch.length) queue.unshift(...batch);
  } catch {
    if (queue.length < MAX_QUEUE - batch.length) queue.unshift(...batch);
  } finally {
    sending = false;
    if (queue.length) scheduleFlush();
  }
}

function viewportBucket(width: number): string {
  if (width <= 360) return "xs";
  if (width <= 430) return "sm";
  if (width <= 767) return "md";
  if (width <= 1023) return "lg";
  return "xl";
}

function browserFamily(ua: string): string {
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Edg\//i.test(ua)) return "edge";
  if (/FxiOS|Firefox/i.test(ua)) return "firefox";
  if (/CriOS|Chrome\//i.test(ua)) return "chrome";
  if (/Safari/i.test(ua) && /Version\//i.test(ua)) return "safari";
  return "other";
}

function osFamily(ua: string): string {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

function deviceClass(ua: string, width: number): string {
  if (/iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobile|iPhone|iPod|Android/i.test(ua) || width < 600) return "phone";
  if (width < 1100 && navigator.maxTouchPoints > 0) return "tablet";
  return "desktop";
}

function bucketNumber(value: number | undefined, thresholds: readonly number[], labels: readonly string[], unknown = "unknown"): string {
  if (value === undefined || !Number.isFinite(value)) return unknown;
  for (let index = 0; index < thresholds.length; index += 1) if (value <= thresholds[index]!) return labels[index]!;
  return labels[labels.length - 1]!;
}

function displayMode(): string {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  if (matchMedia("(display-mode: standalone)").matches || standaloneNavigator.standalone === true) return "standalone";
  if (matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
  return "browser";
}

function connectionInfo(): { type: string; saveData: boolean; supported: boolean } {
  const nav = navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } };
  const connection = nav.connection;
  if (!connection) return { type: "unknown", saveData: false, supported: false };
  const type = ["slow-2g", "2g", "3g", "4g"].includes(connection.effectiveType ?? "")
    ? connection.effectiveType!
    : "unknown";
  return { type, saveData: connection.saveData === true, supported: true };
}

function emitClientStarted(): void {
  const ua = navigator.userAgent;
  const width = window.innerWidth;
  const nav = navigator as Navigator & { deviceMemory?: number; vibrate?: unknown; share?: unknown };
  const connection = connectionInfo();
  enqueue("client_started", {
    deviceClass: deviceClass(ua, width),
    viewportBucket: viewportBucket(width),
    browserFamily: browserFamily(ua),
    osFamily: osFamily(ua),
    displayMode: displayMode(),
    languageGroup: navigator.language.toLowerCase().startsWith("ar") ? "ar" : navigator.language.toLowerCase().startsWith("en") ? "en" : "other",
    touch: navigator.maxTouchPoints > 0,
    connectionType: connection.type,
    saveData: connection.saveData,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    hardwareConcurrencyBucket: bucketNumber(navigator.hardwareConcurrency, [2, 4, 8, Number.POSITIVE_INFINITY], ["1-2", "3-4", "5-8", "9+"]),
    deviceMemoryBucket: bucketNumber(nav.deviceMemory, [2, 4, 8, Number.POSITIVE_INFINITY], ["<=2", "3-4", "5-8", "9+"]),
    pixelRatioBucket: bucketNumber(window.devicePixelRatio, [1, 2, 3, Number.POSITIVE_INFINITY], ["<=1", "1-2", "2-3", "3+"]),
    orientation: innerWidth >= innerHeight ? "landscape" : "portrait",
    audioContext: "AudioContext" in window || "webkitAudioContext" in window,
    vibration: typeof nav.vibrate === "function",
    share: typeof nav.share === "function",
    intlSegmenter: typeof Intl.Segmenter === "function",
    visualViewport: "visualViewport" in window,
    networkInfo: connection.supported,
    routeBucket: routeBucket(),
  });
}

function emitPerformance(): void {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  let transferred = 0;
  for (const resource of resources) transferred += Math.max(0, resource.transferSize || 0);
  const navType = navigation?.type && ["navigate", "reload", "back_forward", "prerender"].includes(navigation.type)
    ? navigation.type
    : "other";
  enqueue("client_performance", {
    navigationType: navType,
    domContentLoadedMs: clamp(navigation?.domContentLoadedEventEnd ?? 0, 120_000),
    loadMs: clamp(navigation?.loadEventEnd ?? 0, 120_000),
    fcpMs: clamp(fcp?.startTime ?? 0, 120_000),
    ttfbMs: clamp(navigation?.responseStart ?? 0, 120_000),
    resourceCount: Math.min(1_000, resources.length),
    transferKb: clamp(transferred / 1024, 100_000),
    routeBucket: routeBucket(),
  });
}

let lcp = 0;
let cls = 0;
let interactionDelay = 0;

function observeVitals(): void {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) lcp = Math.max(lcp, entry.startTime);
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
  } catch { /* unsupported */ }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
        if (!entry.hadRecentInput) cls += entry.value ?? 0;
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  } catch { /* unsupported */ }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) interactionDelay = Math.max(interactionDelay, entry.duration);
    });
    observer.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch { /* unsupported */ }
}

function vitalRating(metric: string, value: number): string {
  if (metric === "LCP") return value <= 2_500 ? "good" : value <= 4_000 ? "needs-improvement" : "poor";
  if (metric === "CLS") return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
  return value <= 200 ? "good" : value <= 500 ? "needs-improvement" : "poor";
}

function emitVitals(): void {
  if (lcp > 0) enqueue("client_vital", { metric: "LCP", value: clamp(lcp, 120_000), rating: vitalRating("LCP", lcp), routeBucket: routeBucket() });
  if (cls > 0) {
    const value = Math.round(cls * 1_000) / 1_000;
    enqueue("client_vital", { metric: "CLS", value, rating: vitalRating("CLS", value), routeBucket: routeBucket() });
  }
  if (interactionDelay > 0) enqueue("client_vital", { metric: "INTERACTION_DELAY", value: clamp(interactionDelay, 60_000), rating: vitalRating("INTERACTION_DELAY", interactionDelay), routeBucket: routeBucket() });
}

let intervalStartedAt = performance.now();
let foregroundStartedAt = document.visibilityState === "visible" ? performance.now() : 0;
let foregroundMs = 0;
let backgroundTransitions = 0;
let offlineTransitions = 0;
let onlineTransitions = 0;
let resizeEvents = 0;
let orientationChanges = 0;
let lastOrientation = innerWidth >= innerHeight ? "landscape" : "portrait";

function accumulateForeground(): void {
  if (foregroundStartedAt > 0) {
    foregroundMs += Math.max(0, performance.now() - foregroundStartedAt);
    foregroundStartedAt = 0;
  }
}

function resetSummaryWindow(): void {
  intervalStartedAt = performance.now();
  foregroundMs = 0;
  backgroundTransitions = 0;
  offlineTransitions = 0;
  onlineTransitions = 0;
  resizeEvents = 0;
  orientationChanges = 0;
  foregroundStartedAt = document.visibilityState === "visible" ? performance.now() : 0;
}

function emitSummary(): void {
  accumulateForeground();
  const now = performance.now();
  enqueue("client_session_summary", {
    lifetimeSeconds: clamp((now - intervalStartedAt) / 1_000, 86_400),
    foregroundSeconds: clamp(foregroundMs / 1_000, 86_400),
    backgroundTransitions,
    offlineTransitions,
    onlineTransitions,
    resizeEvents,
    orientationChanges,
    routeBucket: routeBucket(),
  });
  resetSummaryWindow();
}

function emitClientError(kind: string): void {
  if (errorEvents >= 10) return;
  errorEvents += 1;
  enqueue("client_error", { kind, routeBucket: routeBucket(), online: navigator.onLine });
}

if (typeof window !== "undefined") {
  observeVitals();
  window.setTimeout(emitClientStarted, 2_000);
  window.addEventListener("load", () => window.setTimeout(emitPerformance, 0), { once: true });
  if (document.readyState === "complete") window.setTimeout(emitPerformance, 0);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      accumulateForeground();
      backgroundTransitions += 1;
    } else if (foregroundStartedAt === 0) {
      foregroundStartedAt = performance.now();
    }
  });
  window.addEventListener("offline", () => { offlineTransitions += 1; });
  window.addEventListener("online", () => { onlineTransitions += 1; });
  window.addEventListener("resize", () => {
    resizeEvents = Math.min(1_000, resizeEvents + 1);
    const orientation = innerWidth >= innerHeight ? "landscape" : "portrait";
    if (orientation !== lastOrientation) {
      lastOrientation = orientation;
      orientationChanges = Math.min(1_000, orientationChanges + 1);
    }
  }, { passive: true });
  window.addEventListener("error", (event) => emitClientError(event.target === window ? "runtime" : "resource"), true);
  window.addEventListener("unhandledrejection", () => emitClientError("promise"));

  window.setInterval(() => {
    emitVitals();
    emitSummary();
  }, 5 * 60_000);

  window.addEventListener("pagehide", () => {
    emitVitals();
    emitSummary();
    void flush(true);
  });
}
