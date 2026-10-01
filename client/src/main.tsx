import { Component, StrictMode, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/500.css";
import "@fontsource/tajawal/700.css";
import "@fontsource/tajawal/800.css";
import "@fontsource/tajawal/900.css";
import { reportClientError } from "./telemetry.js";
import { applyTrialFlag } from "./trialFlag.js";
import "./styles.css";
import "./c-ux.css";
import "./game-hud.css";
import "./game-stage.css";
import "./results.css";
import "./lobby.css";
import "./tv-stage.css";
import "./home-suggestion-dialog.css";

async function loadRoot(): Promise<ComponentType> {
  // Display/TV modes intentionally do not import App/socket.ts. This prevents a
  // public screen from ever bootstrapping the owner's participant WebSocket or
  // receiving player secrets before the dedicated display connection starts.
  if (location.pathname.startsWith("/display/")) {
    return (await import("./screens/Display.js")).DisplayApp;
  }

  if (location.pathname === "/tv" || location.pathname === "/tv/") {
    return (await import("./screens/TvPairing.js")).TvPairing;
  }

  if (location.pathname === "/privacy") {
    return (await import("./screens/Privacy.js")).PrivacyApp;
  }

  const [{ App }, { AnalyticsGameObserver }, { PrivacyLink }, { GameChrome }] = await Promise.all([
    import("./App.js"),
    import("./components/AnalyticsGameObserver.js"),
    import("./screens/Privacy.js"),
    import("./components/GameChrome.js"),
  ]);

  return function ParticipantRoot() {
    return (
      <>
        <App />
        <GameChrome />
        <AnalyticsGameObserver />
        <PrivacyLink />
      </>
    );
  };
}

function RuntimeRecovery() {
  return (
    <main className="screen stack center" role="alert">
      <h1 className="title">صار خطأ في عرض اللعبة</h1>
      <p className="subtitle">حدّث الصفحة ونحاول نرجعك للغرفة إذا مكانك محفوظ.</p>
      <button type="button" className="btn btn-primary" onClick={() => location.reload()}>تحديث الصفحة</button>
      {/* Safari can keep a failed download for the life of the tab, so a reload
          alone may not recover; a fresh tab does. */}
      <p className="subtitle">إذا رجع نفس الخطأ بعد التحديث، سكّر الصفحة وافتح رابط اللعبة من جديد.</p>
    </main>
  );
}

class RuntimeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { reportClientError("react", error); }
  render() { return this.state.failed ? <RuntimeRecovery /> : this.props.children; }
}

try {
  applyTrialFlag(location.search, location.protocol === "https:", (cookie) => { document.cookie = cookie; });
} catch { /* cookies can be unavailable; the owner trial marker is optional */ }

const root = createRoot(document.getElementById("root")!);
void loadRoot().then((Root) => {
  root.render(
    <StrictMode>
      <RuntimeBoundary><Root /></RuntimeBoundary>
    </StrictMode>,
  );
}).catch((error: unknown) => {
  reportClientError("bootstrap", error);
  root.render(<RuntimeRecovery />);
});
