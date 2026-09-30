/**
 * Owner trial marker. Opening any page with ?trial=1 marks this browser so its
 * rooms and client telemetry are recorded as analytics environment "test";
 * ?trial=0 removes the mark. It never changes gameplay, identity or access.
 */
export const TRIAL_COOKIE = "kt_trial";

export function applyTrialFlag(search: string, secure: boolean, write: (cookie: string) => void): "on" | "off" | null {
  const value = new URLSearchParams(search).get("trial");
  const suffix = `; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  if (value === "1") {
    write(`${TRIAL_COOKIE}=1; Max-Age=31536000${suffix}`);
    return "on";
  }
  if (value === "0") {
    write(`${TRIAL_COOKIE}=; Max-Age=0${suffix}`);
    return "off";
  }
  return null;
}
