import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/500.css";
import "@fontsource/tajawal/700.css";
import "@fontsource/tajawal/800.css";
import "@fontsource/tajawal/900.css";
import "./telemetry.js";
import "./styles.css";
import "./c-ux.css";
import "./home-suggestion-dialog.css";

async function loadRoot(): Promise<ComponentType> {
  // Display mode intentionally does not import App/socket.ts. This prevents a
  // same-browser display tab from ever bootstrapping the owner's participant
  // WebSocket or receiving player secrets before the display connection starts.
  if (location.pathname.startsWith("/display/")) {
    return (await import("./screens/Display.js")).DisplayApp;
  }

  if (location.pathname === "/privacy") {
    return (await import("./screens/Privacy.js")).PrivacyApp;
  }

  const [{ App }, { AnalyticsGameObserver }, { PrivacyLink }] = await Promise.all([
    import("./App.js"),
    import("./components/AnalyticsGameObserver.js"),
    import("./screens/Privacy.js"),
  ]);

  return function ParticipantRoot() {
    return (
      <>
        <App />
        <AnalyticsGameObserver />
        <PrivacyLink />
      </>
    );
  };
}

void loadRoot().then((Root) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
});
